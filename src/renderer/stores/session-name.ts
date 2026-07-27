const MAX_GENERATED_NAME_LENGTH = 80
const MAX_FALLBACK_NAME_LENGTH = 48
const MODEL_PROTOCOL_MARKER = /<(?:start_|end_)?(?:function|tool)[^>]*>|<escape>|<think>/i

interface SessionNameMessage {
  role?: string
  contentParts?: Array<{ type?: string; text?: string }>
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value)
  return characters.length <= maxLength ? value : `${characters.slice(0, maxLength - 1).join('')}…`
}

export function fallbackSessionName(messages: SessionNameMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user')
  const text = compact(
    (firstUser?.contentParts || [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join(' ')
  )
  return text ? truncate(text, MAX_FALLBACK_NAME_LENGTH) : 'Untitled'
}

/** Keeps protocol tokens or runaway local-model output out of conversation titles. */
export function normalizeGeneratedSessionName(rawName: string, fallback: string): string {
  const withoutThinking = rawName.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const firstLine = withoutThinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  const candidate = compact((firstLine || '').replace(/^#{1,6}\s*/, '').replace(/^['"“”]+|['"“”]+$/g, ''))
  if (!candidate || Array.from(candidate).length > MAX_GENERATED_NAME_LENGTH || MODEL_PROTOCOL_MARKER.test(candidate)) {
    return fallback || 'Untitled'
  }
  return candidate
}
