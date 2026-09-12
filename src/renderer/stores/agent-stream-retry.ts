export const AGENT_TRANSIENT_STREAM_RETRIES = 2
export const AGENT_TRANSIENT_RETRY_BASE_DELAY_MS = 1_500

export function describeAgentStreamError(error: unknown): string {
  const seen = new Set<unknown>()
  const visit = (value: unknown, depth: number): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value)
    if (depth > 3 || seen.has(value)) return ''
    seen.add(value)
    if (value instanceof Error) {
      const cause = 'cause' in value ? visit(value.cause, depth + 1) : ''
      return [`${value.name}: ${value.message}`, cause].filter(Boolean).join(' | ')
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      return ['name', 'message', 'code', 'status', 'statusCode', 'error', 'detail', 'cause']
        .map((key) => {
          const item = visit(record[key], depth + 1)
          return item ? `${key}=${item}` : ''
        })
        .filter(Boolean)
        .join(' | ')
    }
    return String(value)
  }
  return visit(error, 0) || Object.prototype.toString.call(error)
}

export function isTransientAgentStreamError(error: unknown): boolean {
  const message = describeAgentStreamError(error)
  return (
    /(?:EOFException|unexpected end of (?:file|stream)|connection (?:closed|reset)|socket (?:closed|hang up)|network (?:request )?failed|failed to fetch|stream (?:terminated|truncated))/i.test(
      message,
    ) ||
    /(?:status|statusCode)=(?:429|5\d\d)\b/i.test(message) ||
    /(?:servers? (?:are )?(?:currently )?overloaded|service unavailable|bad gateway|gateway timeout|temporarily unavailable|try again later|rate limit)/i.test(
      message,
    )
  )
}

export function getAgentRetryDelayMs(retryCount: number): number {
  return AGENT_TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount)
}

interface RecoverableMessage {
  id?: string
  contentParts?: Array<{ type?: string; state?: string }>
}

/** Resume only after every emitted tool call reached a terminal state. */
export function canResumeAgentStreamAfterTools(completedModelSteps: number, message: RecoverableMessage): boolean {
  if (completedModelSteps < 1 || !message.contentParts?.length) return false
  const toolCalls = message.contentParts.filter((part) => part.type === 'tool-call')
  return toolCalls.length > 0 && toolCalls.every((part) => part.state === 'result' || part.state === 'error')
}

export function buildAgentRecoveryContext<T extends RecoverableMessage>(context: T[], partial: T): T[] {
  return [...context.filter((message) => !partial.id || message.id !== partial.id), partial]
}
