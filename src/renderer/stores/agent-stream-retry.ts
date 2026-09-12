export const AGENT_TRANSIENT_STREAM_RETRIES = 2

/** Only retries a request before any model step (and therefore any tool side effect) completed. */
export function isTransientAgentStreamError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /(?:EOFException|unexpected end of (?:file|stream)|connection (?:closed|reset)|socket (?:closed|hang up)|network (?:request )?failed|failed to fetch|stream (?:terminated|truncated))/i.test(
    message,
  )
}
