/** Custom OpenAI-compatible entries need the same protocol handling as the built-in provider. */
export function isDeepSeekChatModel(modelId: string, apiHost?: string): boolean {
  if (/(?:^|\/)deepseek(?:-|$)/i.test(modelId)) return true
  try {
    return new URL(apiHost || '').hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}

export function normalizeDeepSeekChatBody(url: string, body: RequestInit['body']): RequestInit['body'] {
  if (typeof body !== 'string') return body
  let request: Record<string, unknown>
  try {
    request = JSON.parse(body)
  } catch {
    return body
  }
  if (!request || typeof request !== 'object' || !Array.isArray(request.messages)) return body
  if (!isDeepSeekChatModel(typeof request.model === 'string' ? request.model : '', url)) return body

  // DeepSeek thinking rejects forced tool choice. Keep thinking enabled and let
  // the Agent instructions guide tool use; policy checks still run in the Broker.
  if (request.tool_choice === 'required') request.tool_choice = 'auto'
  request.messages = request.messages.map((message: Record<string, unknown>) => {
    if (!message || message.role !== 'assistant' || typeof message.reasoning_content === 'string') return message
    // Imported turns / turns from another model may have no recorded reasoning.
    // An empty field is valid; never manufacture reasoning for previous replies.
    return { ...message, reasoning_content: '' }
  })
  return JSON.stringify(request)
}
