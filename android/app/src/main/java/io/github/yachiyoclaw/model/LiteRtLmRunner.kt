package io.github.yachiyoclaw.model

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Single-process LiteRT-LM owner. Native models never execute device tools directly. */
object LiteRtLmRunner {
  private data class LoadedEngine(val path: String, val engine: Engine)

  private var loaded: LoadedEngine? = null

  @JvmStatic
  @Synchronized
  fun infer(modelPath: String, messages: JSONArray, maxTokens: Int): String {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    val engine = ensureEngine(modelPath, maxTokens.coerceIn(256, 8192))
    var systemInstruction = ""
    val history = mutableListOf<Message>()
    var prompt = ""

    for (index in 0 until messages.length()) {
      val message = messages.optJSONObject(index) ?: continue
      val role = message.optString("role")
      val text = messageText(message)
      if (text.isBlank()) continue
      when (role) {
        "system" -> systemInstruction = listOf(systemInstruction, text).filter { it.isNotBlank() }.joinToString("\n\n")
        "assistant", "model" -> history += Message.model(text)
        "user" -> {
          if (index == messages.length() - 1) prompt = text else history += Message.user(text)
        }
        else -> history += Message.user("[$role]\n$text")
      }
    }
    if (prompt.isBlank()) prompt = "Continue."

    val conversation =
      engine.createConversation(
        ConversationConfig(
          samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7),
          systemInstruction = if (systemInstruction.isBlank()) null else Contents.of(systemInstruction),
          initialMessages = history,
        )
      )
    return try {
      conversation.sendMessage(Contents.of(prompt)).toString()
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

  private fun ensureEngine(path: String, maxTokens: Int): Engine {
    loaded?.takeIf { it.path == path }?.let { return it.engine }
    unload()
    val engine =
      Engine(
        EngineConfig(
          modelPath = path,
          backend = Backend.CPU(),
          maxNumTokens = maxTokens,
        )
      )
    engine.initialize()
    loaded = LoadedEngine(path, engine)
    return engine
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
}
