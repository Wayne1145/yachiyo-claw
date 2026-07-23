package io.github.yachiyoclaw.model

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import android.util.Base64
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
    var prompt: Contents? = null

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
        "assistant", "model" -> history += Message.model(contents)
        "user" -> {
          if (index == messages.length() - 1) prompt = contents else history += Message.user(contents)
        }
        else -> history += Message.user(contents)
      }
    }
    if (prompt == null) prompt = Contents.of("Continue.")

    val conversation =
      engine.createConversation(
        ConversationConfig(
          samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7),
          systemInstruction = if (systemInstruction.isBlank()) null else Contents.of(systemInstruction),
          initialMessages = history,
        )
      )
    return try {
      val response = conversation.sendMessage(prompt!!)
      response.contents.contents.filterIsInstance<Content.Text>().joinToString("") { it.text }
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
      }
    }
    return Contents.of(parts)
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
