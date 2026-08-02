package io.github.yachiyoclaw.model

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.BenchmarkInfo
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ToolCall
import com.google.ai.edge.litertlm.ToolProvider
import com.google.ai.edge.litertlm.benchmark as runBenchmark
import com.google.ai.edge.litertlm.tool
import java.io.File
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/** Single-process LiteRT-LM owner. Native models never execute device tools directly. */
object LiteRtLmRunner {
  private const val MAX_TOOLS = 64
  private const val MAX_TOOL_DESCRIPTION_CHARS = 4_096
  private data class LoadedEngine(
    val path: String,
    val maxNumTokens: Int,
    val engine: Engine,
    val backend: String,
    val fallbackReason: String?,
  )
  private class InertOpenApiTool(private val descriptor: String) : OpenApiTool {
    override fun getToolDescriptionJsonString(): String = descriptor

    override fun execute(paramsJsonString: String): String {
      throw IllegalStateException("native_tool_execution_disabled")
    }
  }

  private var loaded: LoadedEngine? = null

  @JvmStatic
  @Synchronized
  fun load(
    context: Context,
    modelPath: String,
    requestedBackend: String,
    declaredNpuCompatible: Boolean,
    cpuThreads: Int,
  ) {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    ensureEngine(context, modelPath, 2048, requestedBackend, declaredNpuCompatible, cpuThreads)
  }

  @JvmStatic
  @Synchronized
  fun infer(
    context: Context,
    modelPath: String,
    messages: JSONArray,
    toolDefinitions: JSONObject,
    requestId: String,
    maxTokens: Int,
    requestedBackend: String,
    declaredNpuCompatible: Boolean,
    cpuThreads: Int,
  ): JSONArray {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    val engine = ensureEngine(
      context,
      modelPath,
      maxTokens.coerceIn(256, 8192),
      requestedBackend,
      declaredNpuCompatible,
      cpuThreads,
    )
    var systemInstruction = ""
    val turns = mutableListOf<Message>()

    for (index in 0 until messages.length()) {
      val message = messages.optJSONObject(index) ?: continue
      val role = message.optString("role")
      val contents = messageContents(message)
      if (contents.contents.isEmpty()) continue
      when (role) {
        "system" -> {
          val text = contents.contents.filterIsInstance<Content.Text>().joinToString("\n") { it.text }
          systemInstruction = listOf(systemInstruction, text).filter { it.isNotBlank() }.joinToString("\n\n")
        }
        "assistant", "model" -> turns += Message.model(contents, messageToolCalls(message), emptyMap())
        "user" -> turns += Message.user(contents)
        "tool" -> turns += Message.tool(contents)
        else -> turns += Message.user(contents)
      }
    }
    // The last real turn can be a tool result. Sending a fabricated user "Continue" after it makes
    // small function-calling models repeat the same call instead of consuming the broker result.
    val prompt = if (turns.isEmpty()) Message.user("Continue.") else turns.removeAt(turns.lastIndex)
    systemInstruction = LocalToolProtocol.compactLiteRtSystemInstruction(systemInstruction)

    val conversation =
      engine.createConversation(
        ConversationConfig(
          samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7),
          systemInstruction = if (systemInstruction.isBlank()) null else Contents.of(systemInstruction),
          initialMessages = turns,
          tools = nativeToolProviders(toolDefinitions),
          // Native tools only describe the call grammar. Execution must remain in the WebView Tool Broker.
          automaticToolCalling = false,
        )
      )
    return try {
      val response = conversation.sendMessage(prompt)
      responseEvents(response, toolDefinitions, requestId)
    } finally {
      conversation.close()
    }
  }

  @JvmStatic
  @Synchronized
  fun unload() {
    loaded?.engine?.close()
    loaded = null
  }

  @JvmStatic
  @Synchronized
  fun activeBackend(): String = loaded?.backend ?: ""

  @JvmStatic
  @Synchronized
  fun fallbackReason(): String? = loaded?.fallbackReason

  @JvmStatic
  @OptIn(ExperimentalApi::class)
  fun benchmarkBackend(
    context: Context,
    modelPath: String,
    backendName: String,
    declaredNpuCompatible: Boolean,
    cpuThreads: Int,
    mode: String,
    phase: String,
  ): JSONObject {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    val backend = createBackend(context, modelPath, backendName, declaredNpuCompatible, cpuThreads)
    val npuLibraryDir = if (backendName == AccelerationPolicy.BACKEND_NPU) {
      AccelerationRuntimeSupport.npuLibraryDir(context, modelPath, declaredNpuCompatible).orEmpty()
    } else ""
    val measured = mutableListOf<BenchmarkInfo>()
    val deep = phase == "verify" || AccelerationPolicy.MODE_EXTREME == AccelerationPolicy.normalizeMode(mode)
    val measuredRuns = if (deep) 3 else 1
    val prefillTokens = if (deep) 128 else 64
    val decodeTokens = if (deep) 32 else 12
    for (iteration in 0..measuredRuns) {
      if (!AccelerationRuntimeSupport.canContinueBenchmark(context, mode)) {
        if (measured.isEmpty()) throw IllegalStateException("local_acceleration_thermal_pause")
        break
      }
      val result = runBenchmark(modelPath, backend, prefillTokens, decodeTokens, npuLibraryDir)
      if (iteration > 0) measured += result
    }
    if (measured.isEmpty()) throw IllegalStateException("local_acceleration_thermal_pause")
    fun median(values: List<Double>): Double = values.sorted()[values.size / 2]
    return JSONObject()
      .put("backend", backendName)
      .put("initializationMs", median(measured.map { it.initTimeInSecond }) * 1000.0)
      .put("firstTokenMs", median(measured.map { it.timeToFirstTokenInSecond }) * 1000.0)
      .put("prefillTokensPerSecond", median(measured.map { it.lastPrefillTokensPerSecond }))
      .put("decodeTokensPerSecond", median(measured.map { it.lastDecodeTokensPerSecond }))
  }

  private fun ensureEngine(
    context: Context,
    path: String,
    maxTokens: Int,
    requestedBackend: String,
    declaredNpuCompatible: Boolean,
    cpuThreads: Int,
  ): Engine {
    val normalized = AccelerationPolicy.normalizeBackend(requestedBackend)
    val normalizedBackend = if (normalized == AccelerationPolicy.BACKEND_AUTO) AccelerationPolicy.BACKEND_CPU else normalized
    loaded?.takeIf {
      it.path == path && it.maxNumTokens >= maxTokens && it.backend.lowercase() == normalizedBackend
    }?.let { return it.engine }
    unload()
    val candidates = mutableListOf(normalizedBackend)
    if (normalizedBackend != AccelerationPolicy.BACKEND_CPU) candidates += AccelerationPolicy.BACKEND_CPU
    val failures = mutableListOf<String>()
    for (candidate in candidates.distinct()) {
      val engine = Engine(EngineConfig(
        modelPath = path,
        backend = createBackend(context, path, candidate, declaredNpuCompatible, cpuThreads),
        maxNumTokens = maxTokens,
      ))
      try {
        engine.initialize()
        loaded = LoadedEngine(
          path,
          maxTokens,
          engine,
          candidate.uppercase(),
          failures.takeIf { it.isNotEmpty() }?.joinToString(","),
        )
        return engine
      } catch (error: Throwable) {
        if (error is VirtualMachineError || error is ThreadDeath) throw error
        runCatching { engine.close() }
        failures += "${candidate}_initialization_failed"
      }
    }
    throw IllegalStateException("local_acceleration_backends_unavailable")
  }

  private fun createBackend(
    context: Context,
    modelPath: String,
    backendName: String,
    declaredNpuCompatible: Boolean,
    cpuThreads: Int,
  ): Backend = when (AccelerationPolicy.normalizeBackend(backendName)) {
    AccelerationPolicy.BACKEND_NPU -> Backend.NPU(
      AccelerationRuntimeSupport.npuLibraryDir(context, modelPath, declaredNpuCompatible)
        ?: throw IllegalStateException("local_npu_runtime_unavailable")
    )
    AccelerationPolicy.BACKEND_GPU -> Backend.GPU()
    else -> Backend.CPU(cpuThreads.coerceAtLeast(1))
  }

  private fun messageContents(message: JSONObject): Contents {
    val content = message.opt("content")
    if (content is String) return Contents.of(content)
    if (content !is JSONArray) return Contents.of(content?.toString().orEmpty())
    val parts = mutableListOf<Content>()
    for (index in 0 until content.length()) {
      val part = content.optJSONObject(index) ?: continue
      when (part.optString("type")) {
        "text" -> if (part.optString("text").isNotBlank()) parts += Content.Text(part.optString("text"))
        "image" -> decodeMedia(part.optString("data"))?.let { parts += Content.ImageBytes(it) }
        "audio" -> decodeMedia(part.optString("data"))?.let { parts += Content.AudioBytes(it) }
        "tool-response" -> {
          val name = part.optString("name")
          if (name.matches(Regex("[A-Za-z0-9._:-]{1,120}"))) {
            parts += Content.ToolResponse(name, jsonValue(part.opt("response")) ?: "")
          }
        }
      }
    }
    return Contents.of(parts)
  }

  private fun messageToolCalls(message: JSONObject): List<ToolCall> {
    val content = message.optJSONArray("content") ?: return emptyList()
    val calls = mutableListOf<ToolCall>()
    for (index in 0 until content.length()) {
      val part = content.optJSONObject(index) ?: continue
      if (part.optString("type") != "tool-call") continue
      val name = part.optString("name")
      if (!name.matches(Regex("[A-Za-z0-9._:-]{1,120}"))) continue
      calls += ToolCall(name, jsonObjectToMap(part.optJSONObject("arguments") ?: JSONObject()))
    }
    return calls.take(4)
  }

  private fun nativeToolProviders(definitions: JSONObject): List<ToolProvider> {
    val providers = mutableListOf<ToolProvider>()
    val names = definitions.keys()
    while (names.hasNext() && providers.size < MAX_TOOLS) {
      val name = names.next()
      if (!name.matches(Regex("[A-Za-z0-9._:-]{1,120}"))) continue
      val definition = definitions.optJSONObject(name) ?: continue
      val description = definition.optString("description").take(MAX_TOOL_DESCRIPTION_CHARS)
      val parameters = definition.optJSONObject("inputSchema") ?: JSONObject().put("type", "object")
      val descriptor = JSONObject()
        .put("name", name)
        .put("description", description)
        .put("parameters", parameters)
        .toString()
      providers += tool(InertOpenApiTool(descriptor))
    }
    return providers
  }

  private fun responseEvents(response: Message, allowedTools: JSONObject, requestId: String): JSONArray {
    val events = JSONArray()
    val text = response.contents.contents.filterIsInstance<Content.Text>().joinToString("") { it.text }
    if (text.isNotEmpty()) events.put(JSONObject().put("type", "text").put("text", text))
    val safeRequestId = requestId.takeIf { it.matches(Regex("[A-Za-z0-9._:-]{1,100}")) } ?: "local"
    response.toolCalls.take(4).forEachIndexed { index, call ->
      if (!allowedTools.has(call.name)) return@forEachIndexed
      events.put(
        JSONObject()
          .put("type", "tool-call")
          .put("name", call.name)
          .put("arguments", JSONObject(call.arguments))
          .put("callId", "$safeRequestId-tool-${index + 1}")
      )
    }
    return events
  }

  private fun jsonObjectToMap(value: JSONObject): Map<String, Any?> {
    val result = linkedMapOf<String, Any?>()
    val names = value.keys()
    while (names.hasNext()) {
      val name = names.next()
      result[name] = jsonValue(value.opt(name))
    }
    return result
  }

  private fun jsonValue(value: Any?): Any? = when (value) {
    null, JSONObject.NULL -> null
    is JSONObject -> jsonObjectToMap(value)
    is JSONArray -> (0 until value.length()).map { jsonValue(value.opt(it)) }
    else -> value
  }

  private fun decodeMedia(value: String): ByteArray? {
    if (value.isBlank() || value.length > 32 * 1024 * 1024) return null
    return try {
      Base64.decode(value, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}
