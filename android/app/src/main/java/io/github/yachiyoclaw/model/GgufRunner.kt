package io.github.yachiyoclaw.model

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Owns the process-wide llama.cpp model. Tool execution remains outside the model runtime. */
object GgufRunner {
  init {
    System.loadLibrary("yachiyo_llama")
  }

  @JvmStatic
  @Synchronized
  fun load(modelPath: String, requestId: String, eager: Boolean, gpuLayers: Int, cpuThreads: Int) {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    require(LocalModelFormat.isRunnableGgufPath(modelPath)) { "local_model_not_gguf" }
    nativeLoad(modelPath, requestId, eager, gpuLayers.coerceAtLeast(0), cpuThreads.coerceAtLeast(1))
  }

  @JvmStatic
  fun loadProgress(): Float = nativeLoadProgress().coerceIn(0f, 1f)

  @JvmStatic fun layerCount(modelPath: String): Int = nativeLayerCount(modelPath).coerceAtLeast(0)

  @JvmStatic fun gpuAvailable(): Boolean = nativeGpuAvailable()

  @JvmStatic fun runtimeMetrics(): JSONObject = JSONObject(nativeRuntimeMetrics())

  @JvmStatic
  @Synchronized
  fun infer(
    modelPath: String,
    messages: JSONArray,
    maxTokens: Int,
    requestId: String,
    gpuLayers: Int,
    cpuThreads: Int,
  ): String {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    require(LocalModelFormat.isRunnableGgufPath(modelPath)) { "local_model_not_gguf" }

    val roles = mutableListOf<String>()
    val contents = mutableListOf<String>()
    for (index in 0 until messages.length()) {
      val message = messages.optJSONObject(index) ?: continue
      val content = messageText(message)
      if (content.isBlank()) continue
      roles += normalizeRole(message.optString("role"))
      contents += content
    }
    require(contents.isNotEmpty()) { "local_model_messages_required" }
    return nativeInfer(
      modelPath,
      roles.toTypedArray(),
      contents.toTypedArray(),
      maxTokens.coerceIn(1, 8192),
      requestId,
      gpuLayers.coerceAtLeast(0),
      cpuThreads.coerceAtLeast(1),
    )
  }

  @JvmStatic
  fun cancel(requestId: String) {
    nativeCancel(requestId)
  }

  @JvmStatic
  fun unload() {
    nativeCancel("")
    nativeUnload()
  }

  private fun normalizeRole(role: String): String =
    when (role) {
      "assistant", "model" -> "assistant"
      "system" -> "system"
      "tool" -> "tool"
      else -> "user"
    }

  private fun messageText(message: JSONObject): String {
    val content = message.opt("content")
    if (content is String) return content
    if (content !is JSONArray) return content?.toString().orEmpty()
    val parts = mutableListOf<String>()
    for (index in 0 until content.length()) {
      val part = content.optJSONObject(index) ?: continue
      if (part.optString("type") == "text") parts += part.optString("text")
    }
    return parts.joinToString("\n")
  }

  @JvmStatic
  private external fun nativeLoad(modelPath: String, requestId: String, eager: Boolean, gpuLayers: Int, cpuThreads: Int)

  @JvmStatic private external fun nativeLoadProgress(): Float

  @JvmStatic private external fun nativeLayerCount(modelPath: String): Int

  @JvmStatic private external fun nativeGpuAvailable(): Boolean

  @JvmStatic private external fun nativeRuntimeMetrics(): String

  @JvmStatic
  private external fun nativeInfer(
    modelPath: String,
    roles: Array<String>,
    contents: Array<String>,
    maxTokens: Int,
    requestId: String,
    gpuLayers: Int,
    cpuThreads: Int,
  ): String

  @JvmStatic private external fun nativeCancel(requestId: String)

  @JvmStatic private external fun nativeUnload()
}
