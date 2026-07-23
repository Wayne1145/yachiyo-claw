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
  fun infer(modelPath: String, messages: JSONArray, maxTokens: Int, requestId: String): String {
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
  private external fun nativeInfer(
    modelPath: String,
    roles: Array<String>,
    contents: Array<String>,
    maxTokens: Int,
    requestId: String,
  ): String

  @JvmStatic private external fun nativeCancel(requestId: String)

  @JvmStatic private external fun nativeUnload()
}
