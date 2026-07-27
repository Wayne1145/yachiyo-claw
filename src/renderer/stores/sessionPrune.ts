/**
 * Pure, dependency-free helper deciding whether an abandoned draft session can be pruned.
 *
 * A session is kept when it holds any non-system message, is starred, has fork branches, or is
 * explicitly protected (e.g. linked to a scheduled task). A missing session is never deleted
 * because its emptiness cannot be confirmed.
 */
export function shouldPruneSession(
  session: { messages?: { role: string }[]; starred?: boolean; threads?: unknown[] } | null | undefined,
  protectedSession = false
): boolean {
  if (protectedSession) return false
  if (!session) return false
  if (session.starred) return false
  if (Array.isArray(session.threads) && session.threads.length > 0) return false
  const hasUserContent = (session.messages ?? []).some((message) => message.role !== 'system')
  return !hasUserContent
}
