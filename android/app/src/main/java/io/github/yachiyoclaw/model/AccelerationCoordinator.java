package io.github.yachiyoclaw.model;

import android.content.Context;
import android.content.pm.PackageInfo;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Builds isolated benchmark requests and persists the fastest verified configuration. */
final class AccelerationCoordinator {
    interface BenchmarkRunner { JSONObject run(JSONObject request) throws Exception; }

    private final Context context;
    private final AccelerationProfileStore store;

    AccelerationCoordinator(Context context) {
        this.context = context.getApplicationContext();
        store = new AccelerationProfileStore(context);
    }

    JSONObject settings(String modelId) throws JSONException {
        JSONObject stored = store.settings(modelId);
        return new JSONObject()
            .put("mode", AccelerationPolicy.normalizeMode(stored.optString("mode")))
            .put("requestedBackend", AccelerationPolicy.normalizeBackend(stored.optString("requestedBackend")));
    }

    void saveSettings(String modelId, String mode, String backend) {
        store.saveSettings(modelId, mode, backend);
        store.clearProfile(modelId);
    }

    JSONObject ensureProfile(String modelId, JSONObject job, List<File> models, BenchmarkRunner runner) throws Exception {
        JSONObject settings = settings(modelId);
        String key = cacheKey(job, models, settings.optString("mode"));
        JSONObject cached = store.profile(modelId, key);
        return cached != null ? cached : optimize(modelId, job, models, settings, key, runner);
    }

    JSONObject optimize(String modelId, JSONObject job, List<File> models, BenchmarkRunner runner) throws Exception {
        JSONObject settings = settings(modelId);
        String key = cacheKey(job, models, settings.optString("mode"));
        return optimize(modelId, job, models, settings, key, runner);
    }

    JSONObject runtimeConfiguration(String modelId, JSONObject profile) throws JSONException {
        JSONObject settings = settings(modelId);
        String requested = settings.optString("requestedBackend", AccelerationPolicy.BACKEND_AUTO);
        JSONObject choice = selectRuntimeResult(profile, requested, AccelerationRuntimeSupport.thermallySafe(context));
        String selected = choice.getString("backend");
        JSONObject selectedResult = choice.getJSONObject("result");
        return new JSONObject()
            .put("mode", settings.optString("mode", AccelerationPolicy.MODE_AUTO))
            .put("requestedBackend", requested)
            .put("selectedBackend", selected)
            .put("gpuLayers", selectedResult.optInt("gpuLayers", 0))
            .put("cpuThreads", selectedResult.optInt("cpuThreads", Math.min(8, Runtime.getRuntime().availableProcessors())))
            .put("declaredNpuCompatible", profile.optBoolean("declaredNpuCompatible", false))
            .put("modelVariant", profile.optString("modelVariant"))
            .put("modelPath", selectedResult.optString("modelPath", profile.optString("selectedModelPath")))
            .put("policyFallbackReason", choice.optString("fallbackReason"))
            .put("profile", profile);
    }

    static JSONObject selectRuntimeResult(JSONObject profile, String requestedBackend, boolean thermalSafe) throws JSONException {
        List<String> available = new ArrayList<>();
        JSONArray benchmarks = profile.optJSONArray("benchmarks");
        if (benchmarks != null) for (int index = 0; index < benchmarks.length(); index++) {
            JSONObject result = benchmarks.optJSONObject(index);
            if (result == null || result.has("failureReason")) continue;
            String backend = AccelerationPolicy.normalizeBackend(result.optString("backend"));
            if (!AccelerationPolicy.BACKEND_AUTO.equals(backend) && !available.contains(backend)) available.add(backend);
        }
        AccelerationPolicy.BackendChoice choice = AccelerationPolicy.selectRuntimeBackend(
            requestedBackend, profile.optString("selectedBackend"), available, thermalSafe);
        JSONObject selectedResult = findBackendResult(benchmarks, choice.backend);
        if (selectedResult == null) throw new IllegalStateException("local_acceleration_profile_invalid");
        return new JSONObject().put("backend", choice.backend).put("result", new JSONObject(selectedResult.toString()))
            .put("fallbackReason", choice.fallbackReason);
    }

    void recordPerformance(String modelId, JSONObject profile, JSONObject runtime) {
        if (profile == null || runtime == null) return;
        double actual = runtime.optDouble("decodeTokensPerSecond", 0.0);
        JSONObject selected = profile.optJSONObject("selected");
        double calibrated = selected == null ? 0.0 : selected.optDouble("decodeTokensPerSecond", 0.0);
        if (actual <= 0 || calibrated <= 0) return;
        try {
            JSONArray recent = profile.optJSONArray("recentDecodeTokensPerSecond");
            if (recent == null) recent = new JSONArray();
            recent.put(actual);
            while (recent.length() > 3) recent.remove(0);
            List<Double> values = new ArrayList<>();
            for (int index = 0; index < recent.length(); index++) values.add(recent.optDouble(index));
            if (AccelerationPolicy.shouldRecalibrate(calibrated, values)) {
                store.clearProfile(modelId);
            } else {
                profile.put("recentDecodeTokensPerSecond", recent);
                store.saveProfile(modelId, profile);
            }
        } catch (Exception ignored) {
            // Performance telemetry must never fail a completed inference request.
        }
    }

    JSONObject quarantineAndFallback(String modelId, JSONObject profile, String failedBackend, String reason) throws Exception {
        if (profile == null) throw new IllegalStateException("local_acceleration_profile_invalid");
        JSONObject updated = new JSONObject(profile.toString());
        String failed = AccelerationPolicy.normalizeBackend(failedBackend);
        JSONArray benchmarks = updated.optJSONArray("benchmarks");
        JSONObject next = null;
        if (benchmarks != null) for (int index = 0; index < benchmarks.length(); index++) {
            JSONObject result = benchmarks.optJSONObject(index);
            if (result == null) continue;
            if (failed.equals(AccelerationPolicy.normalizeBackend(result.optString("backend")))) {
                result.put("failureReason", reason);
                continue;
            }
            if (result.has("failureReason")) continue;
            if (next == null || result.optDouble("score") > next.optDouble("score")) next = result;
        }
        if (next == null) throw new IllegalStateException("local_acceleration_backends_unavailable");
        updated.put("selectedBackend", next.optString("backend", AccelerationPolicy.BACKEND_CPU))
            .put("selectedModelPath", next.optString("modelPath"))
            .put("selected", new JSONObject(next.toString()))
            .put("quarantine", new JSONObject()
                .put("backend", failed)
                .put("reason", reason)
                .put("device", AccelerationRuntimeSupport.deviceIdentity())
                .put("runtimeVersion", appVersion())
                .put("at", System.currentTimeMillis()));
        store.saveProfile(modelId, updated);
        JSONObject fallback = runtimeConfiguration(modelId, updated);
        fallback.put("policyFallbackReason", reason);
        return fallback;
    }

    private JSONObject optimize(
        String modelId,
        JSONObject job,
        List<File> models,
        JSONObject settings,
        String key,
        BenchmarkRunner runner
    ) throws Exception {
        if (models == null || models.isEmpty()) throw new IllegalArgumentException("local_model_not_chat_model");
        String mode = settings.optString("mode", AccelerationPolicy.MODE_AUTO);
        List<JSONObject> requests = new ArrayList<>();
        boolean anyNpuCompatible = false;
        for (File model : models) {
            boolean npuCompatible = declaredNpuCompatible(job, model);
            anyNpuCompatible |= npuCompatible;
            List<JSONObject> variantRequests;
            if (model.getName().toLowerCase(Locale.ROOT).endsWith(".litertlm")) {
                variantRequests = liteRtRequests(model, npuCompatible);
            } else if (LocalModelFormat.isRunnableGgufPath(model.getPath())) {
                variantRequests = ggufRequests(model, mode);
            } else continue;
            for (JSONObject request : variantRequests) requests.add(request
                .put("modelPath", model.getPath())
                .put("declaredNpuCompatible", npuCompatible));
        }

        if (!AccelerationRuntimeSupport.thermallySafe(context)) {
            requests.removeIf(request -> !AccelerationPolicy.BACKEND_CPU.equals(request.optString("backend")));
        }
        JSONArray results = new JSONArray();
        List<AccelerationPolicy.Benchmark> scored = new ArrayList<>();
        List<JSONObject> successfulResults = new ArrayList<>();
        for (JSONObject request : requests) {
            request.put("op", "benchmark");
            try {
                JSONObject result = runner.run(request);
                result.put("residentBytes", Math.max(0L, result.optLong("residentBytes")));
                results.put(result);
                AccelerationPolicy.Benchmark benchmark = benchmark(result, null);
                scored.add(benchmark);
                successfulResults.add(result);
            } catch (Throwable error) {
                results.put(new JSONObject(request.toString())
                    .put("failureReason", safeFailure(error)));
            }
        }
        AccelerationPolicy.Benchmark fastest = AccelerationPolicy.selectFastest(scored);
        if (fastest == null) throw new IllegalStateException("local_acceleration_benchmark_failed");
        for (int index = 0; index < scored.size(); index++) successfulResults.get(index).put("score", scored.get(index).score);
        int selectedIndex = -1;
        for (int index = 0; index < scored.size(); index++) if (scored.get(index) == fastest) selectedIndex = index;
        JSONObject selected = new JSONObject(successfulResults.get(selectedIndex).toString()).put("score", fastest.score);
        JSONObject profile = new JSONObject()
            .put("schemaVersion", 1)
            .put("cacheKey", key)
            .put("mode", mode)
            .put("selectedBackend", selected.optString("backend", AccelerationPolicy.BACKEND_CPU))
            .put("selectedModelPath", selected.optString("modelPath"))
            .put("selected", selected)
            .put("benchmarks", results)
            .put("declaredNpuCompatible", anyNpuCompatible)
            .put("modelVariant", new File(selected.optString("modelPath")).getName())
            .put("thermalStatus", AccelerationRuntimeSupport.thermalStatus(context))
            .put("optimizedAt", System.currentTimeMillis());
        store.saveProfile(modelId, profile);
        return profile;
    }

    private List<JSONObject> liteRtRequests(File model, boolean npuCompatible) throws JSONException {
        List<JSONObject> requests = new ArrayList<>();
        int defaultThreads = Math.max(1, Math.min(8, Runtime.getRuntime().availableProcessors()));
        List<String> backends = npuCompatible
            ? List.of(AccelerationPolicy.BACKEND_NPU)
            : List.of(AccelerationPolicy.BACKEND_GPU, AccelerationPolicy.BACKEND_CPU);
        for (String backend : backends) {
            if (AccelerationPolicy.BACKEND_CPU.equals(backend)) {
                for (int threads : AccelerationRuntimeSupport.cpuThreadCandidates()) {
                    requests.add(new JSONObject().put("backend", backend).put("cpuThreads", threads));
                }
            } else {
                requests.add(new JSONObject().put("backend", backend).put("cpuThreads", defaultThreads));
            }
        }
        return requests;
    }

    private List<JSONObject> ggufRequests(File model, String mode) throws JSONException {
        List<JSONObject> requests = new ArrayList<>();
        int defaultThreads = Math.max(1, Math.min(8, Runtime.getRuntime().availableProcessors()));
        int[] percentages = AccelerationPolicy.MODE_EXTREME.equals(AccelerationPolicy.normalizeMode(mode))
            ? new int[] {100, 75, 50, 25} : new int[] {75, 50, 25};
        for (int percentage : percentages) {
            requests.add(new JSONObject().put("backend", AccelerationPolicy.BACKEND_GPU)
                .put("gpuLayerPercent", percentage).put("cpuThreads", defaultThreads));
        }
        for (int threads : AccelerationRuntimeSupport.cpuThreadCandidates()) {
            requests.add(new JSONObject().put("backend", AccelerationPolicy.BACKEND_CPU)
                .put("gpuLayerPercent", 0).put("cpuThreads", threads));
        }
        return requests;
    }

    private static AccelerationPolicy.Benchmark benchmark(JSONObject value, String failure) {
        return new AccelerationPolicy.Benchmark(
            value.optString("backend"),
            value.optDouble("initializationMs"),
            value.optDouble("firstTokenMs"),
            value.optDouble("prefillTokensPerSecond"),
            value.optDouble("decodeTokensPerSecond"),
            value.optLong("residentBytes"),
            failure
        );
    }

    private String cacheKey(JSONObject job, List<File> models, String mode) {
        return AccelerationPolicy.cacheKey(
            modelDigest(job, models),
            AccelerationRuntimeSupport.deviceIdentity(),
            appVersion(),
            models.stream().map(File::getName).sorted().reduce("", (left, right) -> left + "|" + right),
            mode
        );
    }

    private String appVersion() {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "unknown" : info.versionName;
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    private static String modelDigest(JSONObject job, List<File> models) {
        StringBuilder result = new StringBuilder();
        JSONArray artifacts = job.optJSONArray("artifacts");
        if (artifacts != null) for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.optJSONObject(index);
            if (artifact == null) continue;
            String filename = artifact.optString("filename", artifact.optString("path"));
            String digest = artifact.optString("sha256", artifact.optString("hash"));
            if (!digest.isBlank()) result.append(filename).append(':').append(digest).append('|');
        }
        if (result.length() > 0) return result.toString();
        for (File model : models) result.append(model.getName()).append(':').append(model.length()).append(':')
            .append(model.lastModified()).append('|');
        return result.toString();
    }

    private static boolean declaredNpuCompatible(JSONObject job, File model) {
        JSONArray artifacts = job.optJSONArray("artifacts");
        if (artifacts == null) return false;
        for (int index = 0; index < artifacts.length(); index++) {
            JSONObject artifact = artifacts.optJSONObject(index);
            if (artifact == null) continue;
            String filename = new File(artifact.optString("filename", artifact.optString("path"))).getName();
            if (!model.getName().equals(filename)) continue;
            JSONObject metadata = artifact.optJSONObject("metadata");
            if (metadata == null) metadata = new JSONObject();
            JSONArray targets = artifact.optJSONArray("backendTargets");
            if (targets == null) targets = metadata.optJSONArray("backendTargets");
            if (!containsIgnoreCase(targets, AccelerationPolicy.BACKEND_NPU)) continue;
            JSONArray socModels = artifact.optJSONArray("socModels");
            if (socModels == null) socModels = metadata.optJSONArray("socModels");
            JSONObject vendorRuntime = artifact.optJSONObject("vendorRuntime");
            if (vendorRuntime == null) vendorRuntime = metadata.optJSONObject("vendorRuntime");
            String actualSoc = AccelerationRuntimeSupport.socModel();
            if (vendorRuntime != null
                    && AccelerationRuntimeSupport.declaredSocMatches(socModels, actualSoc)
                    && AccelerationRuntimeSupport.declaredVendorMatches(vendorRuntime.optString("vendor"), actualSoc)) {
                return true;
            }
        }
        return false;
    }

    private static JSONObject findBackendResult(JSONArray results, String backend) {
        if (results == null) return null;
        JSONObject best = null;
        for (int index = 0; index < results.length(); index++) {
            JSONObject result = results.optJSONObject(index);
            if (result == null || result.has("failureReason") || !backend.equals(result.optString("backend"))) continue;
            if (best == null || result.optDouble("score") > best.optDouble("score")) best = result;
        }
        return best;
    }

    private static boolean containsIgnoreCase(JSONArray values, String expected) {
        if (values == null) return false;
        for (int index = 0; index < values.length(); index++) if (expected.equalsIgnoreCase(values.optString(index))) return true;
        return false;
    }

    private static String safeFailure(Throwable error) {
        String message = error.getMessage();
        return message != null && message.matches("[A-Za-z0-9._-]{1,120}") ? message : "backend_benchmark_failed";
    }
}
