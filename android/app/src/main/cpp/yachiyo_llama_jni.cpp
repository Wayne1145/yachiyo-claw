#include <jni.h>

#include "llama.h"
#include "ggml-backend.h"
#include "gguf.h"

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

std::mutex g_model_mutex;
std::mutex g_request_mutex;
std::atomic<bool> g_cancelled{false};
std::atomic<float> g_load_progress{0.0F};
llama_model * g_model = nullptr;
std::string g_model_path;
std::string g_active_backend;
std::string g_fallback_reason;
std::string g_gpu_device;
bool g_model_eager = false;
int32_t g_configured_gpu_layers = 0;
int32_t g_offloaded_layers = 0;
int32_t g_cpu_threads = 0;
double g_first_token_ms = 0.0;
double g_prefill_tokens_per_second = 0.0;
double g_decode_tokens_per_second = 0.0;
size_t g_gpu_free_bytes = 0;
size_t g_gpu_total_bytes = 0;
std::string g_request_id;
std::once_flag g_backend_once;

struct ContextDeleter {
    void operator()(llama_context * value) const { llama_free(value); }
};

struct SamplerDeleter {
    void operator()(llama_sampler * value) const { llama_sampler_free(value); }
};

using ContextPtr = std::unique_ptr<llama_context, ContextDeleter>;
using SamplerPtr = std::unique_ptr<llama_sampler, SamplerDeleter>;

std::string from_jstring(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const jchar * chars = env->GetStringChars(value, nullptr);
    if (chars == nullptr) throw std::runtime_error("local_model_string_invalid");
    const jsize length = env->GetStringLength(value);
    std::string result;
    result.reserve(static_cast<size_t>(length) * 3);
    for (jsize index = 0; index < length; ++index) {
        uint32_t code_point = chars[index];
        if (code_point >= 0xD800 && code_point <= 0xDBFF && index + 1 < length) {
            const uint32_t low = chars[index + 1];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                code_point = 0x10000 + ((code_point - 0xD800) << 10) + (low - 0xDC00);
                ++index;
            }
        }
        if (code_point <= 0x7F) {
            result.push_back(static_cast<char>(code_point));
        } else if (code_point <= 0x7FF) {
            result.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
            result.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
        } else if (code_point <= 0xFFFF) {
            result.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
            result.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
        } else {
            result.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
            result.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
            result.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
        }
    }
    env->ReleaseStringChars(value, chars);
    return result;
}

jstring to_jstring(JNIEnv * env, const std::string & value) {
    jbyteArray bytes = env->NewByteArray(static_cast<jsize>(value.size()));
    if (bytes == nullptr) return nullptr;
    env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(value.size()), reinterpret_cast<const jbyte *>(value.data()));
    jclass string_class = env->FindClass("java/lang/String");
    jmethodID constructor = env->GetMethodID(string_class, "<init>", "([BLjava/lang/String;)V");
    jstring charset = env->NewStringUTF("UTF-8");
    auto result = static_cast<jstring>(env->NewObject(string_class, constructor, bytes, charset));
    env->DeleteLocalRef(charset);
    env->DeleteLocalRef(bytes);
    env->DeleteLocalRef(string_class);
    return result;
}

std::vector<std::string> from_jstring_array(JNIEnv * env, jobjectArray values) {
    const jsize length = values == nullptr ? 0 : env->GetArrayLength(values);
    std::vector<std::string> result;
    result.reserve(static_cast<size_t>(length));
    for (jsize index = 0; index < length; ++index) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(values, index));
        result.push_back(from_jstring(env, value));
        env->DeleteLocalRef(value);
    }
    return result;
}

void throw_java(JNIEnv * env, const char * code) {
    jclass exception = env->FindClass("java/lang/IllegalStateException");
    if (exception != nullptr) env->ThrowNew(exception, code);
}

bool abort_requested(void *) {
    return g_cancelled.load(std::memory_order_relaxed);
}

bool continue_loading(float progress, void *) {
    g_load_progress.store(std::clamp(progress, 0.0F, 1.0F), std::memory_order_relaxed);
    return !g_cancelled.load(std::memory_order_relaxed);
}

void begin_request(const std::string & request_id) {
    std::lock_guard<std::mutex> lock(g_request_mutex);
    g_request_id = request_id;
    g_cancelled.store(false, std::memory_order_relaxed);
}

void end_request() {
    std::lock_guard<std::mutex> lock(g_request_mutex);
    g_request_id.clear();
    g_cancelled.store(false, std::memory_order_relaxed);
}

void ensure_backend() {
    std::call_once(g_backend_once, [] {
        // llama.cpp can otherwise emit model metadata, paths, and prompt-related diagnostics.
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        llama_backend_init();
    });
}

int32_t gguf_layer_count(const std::string & path) {
    gguf_init_params params{};
    params.no_alloc = true;
    gguf_context * metadata = gguf_init_from_file(path.c_str(), params);
    if (metadata == nullptr) throw std::runtime_error("local_model_metadata_failed");
    const int64_t architecture_key = gguf_find_key(metadata, "general.architecture");
    if (architecture_key < 0 || gguf_get_kv_type(metadata, architecture_key) != GGUF_TYPE_STRING) {
        gguf_free(metadata);
        throw std::runtime_error("local_model_architecture_missing");
    }
    const std::string block_key = std::string(gguf_get_val_str(metadata, architecture_key)) + ".block_count";
    const int64_t key = gguf_find_key(metadata, block_key.c_str());
    int32_t result = 0;
    if (key >= 0) {
        switch (gguf_get_kv_type(metadata, key)) {
            case GGUF_TYPE_UINT32: result = static_cast<int32_t>(gguf_get_val_u32(metadata, key)); break;
            case GGUF_TYPE_INT32: result = gguf_get_val_i32(metadata, key); break;
            case GGUF_TYPE_UINT64: result = static_cast<int32_t>(gguf_get_val_u64(metadata, key)); break;
            case GGUF_TYPE_INT64: result = static_cast<int32_t>(gguf_get_val_i64(metadata, key)); break;
            default: break;
        }
    }
    gguf_free(metadata);
    if (result <= 0 || result > 1000) throw std::runtime_error("local_model_layer_count_invalid");
    return result;
}

void refresh_gpu_info() {
    g_gpu_device.clear();
    g_gpu_free_bytes = 0;
    g_gpu_total_bytes = 0;
    for (size_t index = 0; index < ggml_backend_dev_count(); ++index) {
        ggml_backend_dev_t device = ggml_backend_dev_get(index);
        if (ggml_backend_dev_type(device) != GGML_BACKEND_DEVICE_TYPE_GPU) continue;
        g_gpu_device = ggml_backend_dev_description(device);
        ggml_backend_dev_memory(device, &g_gpu_free_bytes, &g_gpu_total_bytes);
        break;
    }
}

void ensure_model(const std::string & path, bool eager, int32_t requested_gpu_layers, int32_t cpu_threads) {
    // An eager instance satisfies ordinary inference too. A mmap instance must be reloaded when
    // the user explicitly requests that all model weights be read into process memory.
    if (g_model != nullptr && g_model_path == path && g_configured_gpu_layers == requested_gpu_layers
            && g_cpu_threads == cpu_threads && (!eager || g_model_eager)) {
        g_load_progress.store(1.0F, std::memory_order_relaxed);
        return;
    }
    g_load_progress.store(0.0F, std::memory_order_relaxed);
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
        g_model_path.clear();
        g_active_backend.clear();
        g_fallback_reason.clear();
        g_model_eager = false;
    }
    int32_t gpu_layers = requested_gpu_layers;
    if (gpu_layers > 0) {
        refresh_gpu_info();
        if (!llama_supports_gpu_offload() || g_gpu_device.empty()) {
            gpu_layers = 0;
            g_fallback_reason = "gpu_unavailable";
        }
    } else {
        g_gpu_device.clear();
        g_gpu_free_bytes = 0;
        g_gpu_total_bytes = 0;
    }
    llama_model_params params = llama_model_default_params();
    // A non-null, empty device list prevents CPU-only loads from probing broken OEM/emulator
    // Vulkan devices. llama.cpp otherwise enumerates every GPU even when n_gpu_layers is zero.
    ggml_backend_dev_t no_offload_devices[] = {nullptr};
    params.n_gpu_layers = gpu_layers;
    if (gpu_layers == 0) params.devices = no_offload_devices;
    params.use_mmap = !eager;
    params.use_mlock = false;
    params.progress_callback = continue_loading;
    g_model = llama_model_load_from_file(path.c_str(), params);
    if (g_model == nullptr && gpu_layers > 0 && !g_cancelled.load(std::memory_order_relaxed)) {
        params.n_gpu_layers = 0;
        params.devices = no_offload_devices;
        g_load_progress.store(0.0F, std::memory_order_relaxed);
        g_model = llama_model_load_from_file(path.c_str(), params);
        if (g_model != nullptr) {
            gpu_layers = 0;
            g_fallback_reason = "gpu_model_load_failed";
        }
    }
    if (g_model == nullptr) {
        if (g_cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("local_inference_cancelled");
        throw std::runtime_error("local_model_load_failed");
    }
    g_model_path = path;
    g_configured_gpu_layers = requested_gpu_layers;
    g_offloaded_layers = gpu_layers > 0 ? std::min(gpu_layers, llama_model_n_layer(g_model)) : 0;
    g_cpu_threads = std::max(1, cpu_threads);
    g_active_backend = g_offloaded_layers > 0 ? "GPU+CPU" : "CPU";
    g_model_eager = eager;
    g_load_progress.store(1.0F, std::memory_order_relaxed);
}

std::string model_metadata(const char * key) {
    std::vector<char> buffer(128);
    int32_t written = llama_model_meta_val_str(g_model, key, buffer.data(), buffer.size());
    if (written < 0) {
        buffer.resize(static_cast<size_t>(-written) + 1);
        written = llama_model_meta_val_str(g_model, key, buffer.data(), buffer.size());
    }
    return written > 0 ? std::string(buffer.data(), static_cast<size_t>(written)) : std::string();
}

std::string apply_chat_template(
    const std::vector<std::string> & roles,
    const std::vector<std::string> & contents
) {
    std::vector<llama_chat_message> messages;
    messages.reserve(roles.size());
    for (size_t index = 0; index < roles.size(); ++index) {
        messages.push_back({roles[index].c_str(), contents[index].c_str()});
    }
    const char * chat_template = llama_model_chat_template(g_model, nullptr);
    int32_t required = chat_template == nullptr
        ? 0
        : llama_chat_apply_template(chat_template, messages.data(), messages.size(), true, nullptr, 0);
    if (required <= 0) {
        const std::string architecture = model_metadata("general.architecture");
        // llama_chat_apply_template intentionally supports a bounded template set. Newer GGUFs can
        // carry valid Jinja that is not recognized yet, so select a conservative built-in family.
        chat_template = architecture.find("gemma") != std::string::npos ? "gemma" : "chatml";
        required = llama_chat_apply_template(chat_template, messages.data(), messages.size(), true, nullptr, 0);
    }
    if (required <= 0) {
        std::string plain;
        for (size_t index = 0; index < roles.size(); ++index) {
            plain += roles[index];
            plain += ": ";
            plain += contents[index];
            plain += "\n";
        }
        plain += "assistant: ";
        return plain;
    }
    std::vector<char> formatted(static_cast<size_t>(required) + 1);
    int32_t written = llama_chat_apply_template(
        chat_template,
        messages.data(),
        messages.size(),
        true,
        formatted.data(),
        static_cast<int32_t>(formatted.size())
    );
    if (written < 0 || written > static_cast<int32_t>(formatted.size())) {
        throw std::runtime_error("local_model_chat_template_failed");
    }
    return {formatted.data(), static_cast<size_t>(written)};
}

std::vector<llama_token> tokenize(const llama_vocab * vocab, const std::string & prompt) {
    int32_t required = llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, true);
    if (required >= 0) throw std::runtime_error("local_model_tokenize_failed");
    std::vector<llama_token> tokens(static_cast<size_t>(-required));
    int32_t written = llama_tokenize(
        vocab,
        prompt.data(),
        prompt.size(),
        tokens.data(),
        static_cast<int32_t>(tokens.size()),
        true,
        true
    );
    if (written < 0) throw std::runtime_error("local_model_tokenize_failed");
    tokens.resize(static_cast<size_t>(written));
    return tokens;
}

std::string token_piece(const llama_vocab * vocab, llama_token token) {
    std::vector<char> buffer(256);
    int32_t written = llama_token_to_piece(vocab, token, buffer.data(), buffer.size(), 0, true);
    if (written < 0) {
        buffer.resize(static_cast<size_t>(-written));
        written = llama_token_to_piece(vocab, token, buffer.data(), buffer.size(), 0, true);
    }
    if (written < 0) throw std::runtime_error("local_model_detokenize_failed");
    return {buffer.data(), static_cast<size_t>(written)};
}

std::string generate(
    const std::string & path,
    const std::vector<std::string> & roles,
    const std::vector<std::string> & contents,
    int32_t max_tokens,
    int32_t gpu_layers,
    int32_t cpu_threads
) {
    std::lock_guard<std::mutex> model_lock(g_model_mutex);
    ensure_backend();
    ensure_model(path, false, gpu_layers, cpu_threads);
    const double inference_started_ms = static_cast<double>(llama_time_us()) / 1000.0;

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    std::vector<llama_token> prompt_tokens = tokenize(vocab, apply_chat_template(roles, contents));
    if (prompt_tokens.empty()) throw std::runtime_error("local_model_prompt_empty");

    const uint32_t trained_context = static_cast<uint32_t>(std::max(0, llama_model_n_ctx_train(g_model)));
    const uint32_t context_limit = trained_context == 0 ? 4096U : std::min(trained_context, 16384U);
    const uint64_t required_context = static_cast<uint64_t>(prompt_tokens.size()) + static_cast<uint64_t>(max_tokens);
    if (required_context > context_limit) throw std::runtime_error("local_model_context_exceeded");

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = std::min(context_limit, std::max<uint32_t>(512U, static_cast<uint32_t>(required_context)));
    context_params.n_batch = std::min<uint32_t>(context_params.n_ctx, 512U);
    context_params.n_ubatch = context_params.n_batch;
    const uint32_t hardware_threads = std::max(1U, std::thread::hardware_concurrency());
    const int32_t threads = std::max(1, std::min(cpu_threads, static_cast<int32_t>(hardware_threads)));
    context_params.n_threads = threads;
    context_params.n_threads_batch = threads;
    context_params.abort_callback = abort_requested;
    context_params.abort_callback_data = nullptr;
    context_params.no_perf = false;

    ContextPtr context(llama_init_from_model(g_model, context_params));
    if (!context) throw std::runtime_error("local_model_context_init_failed");

    size_t offset = 0;
    while (offset < prompt_tokens.size()) {
        if (g_cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("local_inference_cancelled");
        const size_t count = std::min<size_t>(context_params.n_batch, prompt_tokens.size() - offset);
        llama_batch batch = llama_batch_get_one(prompt_tokens.data() + offset, static_cast<int32_t>(count));
        if (llama_decode(context.get(), batch) != 0) {
            if (g_cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("local_inference_cancelled");
            throw std::runtime_error("local_model_decode_failed");
        }
        offset += count;
    }

    SamplerPtr sampler(llama_sampler_chain_init(llama_sampler_chain_default_params()));
    if (!sampler) throw std::runtime_error("local_model_sampler_init_failed");
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_k(40));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_p(0.95F, 1));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(0.7F));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string response;
    g_first_token_ms = 0.0;
    for (int32_t generated = 0; generated < max_tokens; ++generated) {
        if (g_cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("local_inference_cancelled");
        llama_token token = llama_sampler_sample(sampler.get(), context.get(), -1);
        if (llama_vocab_is_eog(vocab, token)) break;
        if (g_first_token_ms == 0.0) g_first_token_ms = static_cast<double>(llama_time_us()) / 1000.0 - inference_started_ms;
        response += token_piece(vocab, token);
        llama_batch batch = llama_batch_get_one(&token, 1);
        if (llama_decode(context.get(), batch) != 0) {
            if (g_cancelled.load(std::memory_order_relaxed)) throw std::runtime_error("local_inference_cancelled");
            throw std::runtime_error("local_model_decode_failed");
        }
    }
    const llama_perf_context_data performance = llama_perf_context(context.get());
    g_prefill_tokens_per_second = performance.t_p_eval_ms > 0
        ? performance.n_p_eval * 1000.0 / performance.t_p_eval_ms : 0.0;
    g_decode_tokens_per_second = performance.t_eval_ms > 0
        ? performance.n_eval * 1000.0 / performance.t_eval_ms : 0.0;
    return response;
}

std::string json_escape(const std::string & value) {
    std::string result;
    result.reserve(value.size());
    for (char character : value) {
        if (character == '\\' || character == '"') result.push_back('\\');
        if (static_cast<unsigned char>(character) >= 0x20) result.push_back(character);
    }
    return result;
}

std::string runtime_metrics_json() {
    return std::string("{\"activeBackend\":\"") + json_escape(g_active_backend)
        + "\",\"fallbackReason\":\"" + json_escape(g_fallback_reason)
        + "\",\"gpuDevice\":\"" + json_escape(g_gpu_device)
        + "\",\"offloadedLayers\":" + std::to_string(g_offloaded_layers)
        + ",\"cpuThreads\":" + std::to_string(g_cpu_threads)
        + ",\"firstTokenMs\":" + std::to_string(g_first_token_ms)
        + ",\"prefillTokensPerSecond\":" + std::to_string(g_prefill_tokens_per_second)
        + ",\"decodeTokensPerSecond\":" + std::to_string(g_decode_tokens_per_second)
        + ",\"gpuFreeBytes\":" + std::to_string(g_gpu_free_bytes)
        + ",\"gpuTotalBytes\":" + std::to_string(g_gpu_total_bytes) + "}";
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeLoad(
    JNIEnv * env,
    jclass,
    jstring model_path,
    jstring request_id,
    jboolean eager,
    jint gpu_layers,
    jint cpu_threads
) {
    try {
        const std::string path = from_jstring(env, model_path);
        const std::string request = from_jstring(env, request_id);
        begin_request(request);
        try {
            std::lock_guard<std::mutex> model_lock(g_model_mutex);
            ensure_backend();
            ensure_model(path, eager == JNI_TRUE, std::max(0, static_cast<int32_t>(gpu_layers)),
                std::max(1, static_cast<int32_t>(cpu_threads)));
            end_request();
        } catch (...) {
            end_request();
            throw;
        }
    } catch (const std::exception & error) {
        throw_java(env, error.what());
    } catch (...) {
        throw_java(env, "local_model_load_failed");
    }
}

extern "C" JNIEXPORT jfloat JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeLoadProgress(JNIEnv *, jclass) {
    return g_load_progress.load(std::memory_order_relaxed);
}

extern "C" JNIEXPORT jint JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeLayerCount(JNIEnv * env, jclass, jstring model_path) {
    try {
        return gguf_layer_count(from_jstring(env, model_path));
    } catch (const std::exception & error) {
        throw_java(env, error.what());
        return 0;
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeGpuAvailable(JNIEnv *, jclass) {
    ensure_backend();
    refresh_gpu_info();
    return llama_supports_gpu_offload() && !g_gpu_device.empty() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeRuntimeMetrics(JNIEnv * env, jclass) {
    std::lock_guard<std::mutex> model_lock(g_model_mutex);
    return env->NewStringUTF(runtime_metrics_json().c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeInfer(
    JNIEnv * env,
    jclass,
    jstring model_path,
    jobjectArray roles,
    jobjectArray contents,
    jint max_tokens,
    jstring request_id,
    jint gpu_layers,
    jint cpu_threads
) {
    try {
        std::string path = from_jstring(env, model_path);
        std::string request = from_jstring(env, request_id);
        std::vector<std::string> role_values = from_jstring_array(env, roles);
        std::vector<std::string> content_values = from_jstring_array(env, contents);
        if (role_values.empty() || role_values.size() != content_values.size()) {
            throw std::runtime_error("local_model_messages_invalid");
        }
        begin_request(request);
        try {
            std::string result = generate(path, role_values, content_values,
                std::max(1, static_cast<int32_t>(max_tokens)),
                std::max(0, static_cast<int32_t>(gpu_layers)),
                std::max(1, static_cast<int32_t>(cpu_threads)));
            end_request();
            return to_jstring(env, result);
        } catch (...) {
            end_request();
            throw;
        }
    } catch (const std::exception & error) {
        throw_java(env, error.what());
        return nullptr;
    } catch (...) {
        throw_java(env, "local_inference_failed");
        return nullptr;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeCancel(JNIEnv * env, jclass, jstring request_id) {
    try {
        std::string requested = from_jstring(env, request_id);
        std::lock_guard<std::mutex> lock(g_request_mutex);
        if (requested.empty() || requested == g_request_id) g_cancelled.store(true, std::memory_order_relaxed);
    } catch (...) {
        throw_java(env, "local_inference_cancel_failed");
    }
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_yachiyoclaw_model_GgufRunner_nativeUnload(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(g_model_mutex);
    if (g_model != nullptr) llama_model_free(g_model);
    g_model = nullptr;
    g_model_path.clear();
    g_active_backend.clear();
    g_fallback_reason.clear();
    g_gpu_device.clear();
    g_model_eager = false;
    g_configured_gpu_layers = 0;
    g_offloaded_layers = 0;
    g_cpu_threads = 0;
    g_first_token_ms = 0.0;
    g_prefill_tokens_per_second = 0.0;
    g_decode_tokens_per_second = 0.0;
    g_load_progress.store(0.0F, std::memory_order_relaxed);
}
