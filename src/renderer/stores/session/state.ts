// Shared state for debouncing/deduplicating name generation requests.
// Isolated here to avoid circular imports between naming.ts and other session modules.

// Key format: `name-${sessionId}` or `thread-${sessionId}`
export const pendingNameGenerations = new Map<string, ReturnType<typeof setTimeout>>()
export const activeNameGenerations = new Set<string>()
