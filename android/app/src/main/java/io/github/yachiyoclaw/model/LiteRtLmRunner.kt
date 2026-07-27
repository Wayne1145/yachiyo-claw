package io.github.yachiyoclaw.model

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ToolCall
import com.google.ai.edge.litertlm.ToolProvider
import com.google.ai.edge.litertlm.tool
import java.io.File
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/** Single-process LiteRT-LM owner. Native models never execute device tools directly. */
object LiteRtLmRunner {
  private const val MAX_TOOLS = 64
  private const val MAX_TOOL_DESCRIPTION_CHARS = 4_096
  private data class LoadedEngine(val path: String, val engine: Engine)
  private class InertOpenApiTool(private val descriptor: String) : OpenApiTool {
    override fun getToolDescriptionJsonString(): String = descriptor

    override fun execute(paramsJsonString: String): String {
      throw IllegalStateException("native_tool_execution_disabled")
    }
  }

  private var loaded: LoadedEngine? = null

  @JvmStatic
  @Synchronized
  fun load(modelPath: String) {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    ensureEngine(modelPath, 2048)
  }

  @JvmStatic
  @Synchronized
  fun infer(
    modelPath: String,
    messages: JSONArray,
    toolDefinitions: JSONObject,
    requestId: String,
    maxTokens: Int,
  ): JSONArray {
    require(File(modelPath).isFile) { "local_model_file_missing" }
    val engine = ensureEngine(modelPath, maxTokens.coerceIn(256, 8192))
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
