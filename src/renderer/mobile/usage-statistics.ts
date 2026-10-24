/** Privacy-preserving accounting: never persist prompts, tool arguments, or credentials. */
export interface UsageEntry {
  id: string
  at: number
  provider: string
  model: string
  mode: 'chat' | 'agent' | 'realtime'
  input: number
  output: number
  reasoning: number
  cached: number
  total: number
  toolCalls: number
  cacheReported?: boolean
}

export const USAGE_STORAGE_KEY = 'yachiyo.usage.statistics.v1'
export const USAGE_CHANGED = 'yachiyo-usage-changed'
const RETENTION = 90 * 86400000
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0)
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

export function normalizeUsage(
  value: unknown
): Pick<UsageEntry, 'input' | 'output' | 'reasoning' | 'cached' | 'total' | 'cacheReported'> {
  const usage = object(value)
  const inputDetails = object(usage.inputTokenDetails ?? usage.input_tokens_details ?? usage.prompt_tokens_details)
  const outputDetails = object(
    usage.outputTokenDetails ?? usage.output_tokens_details ?? usage.completion_tokens_details
  )
  const input = count(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens)
  const output = count(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens)
  const cacheReported = [
    usage.cachedInputTokens,
    inputDetails.cacheReadTokens,
    inputDetails.cached_tokens,
    usage.cache_read_input_tokens,
  ].some((value) => typeof value === 'number' && Number.isFinite(value))
  return {
    input,
    output,
    reasoning: count(usage.reasoningTokens ?? outputDetails.reasoningTokens ?? outputDetails.reasoning_tokens),
    cached: Math.min(
      input,
      count(
        usage.cachedInputTokens ??
          inputDetails.cacheReadTokens ??
          inputDetails.cached_tokens ??
          usage.cache_read_input_tokens
      )
    ),
    total: count(usage.totalTokens ?? usage.total_tokens) || input + output,
    cacheReported,
  }
}

export function readUsageEntries(): UsageEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || '[]')
    return Array.isArray(value)
      ? value.filter(
          (item) => item && typeof item.id === 'string' && Number.isFinite(item.at) && item.at >= Date.now() - RETENTION
        )
      : []
  } catch {
    return []
  }
}

export function recordUsage(entry: UsageEntry): void {
  if (!entry.total) return
  try {
    const entries = readUsageEntries().filter((item) => item.id !== entry.id)
    entries.push(entry)
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(entries.slice(-10000)))
    window.dispatchEvent(new Event(USAGE_CHANGED))
  } catch {
    /* Accounting failures must never interrupt a model stream. */
  }
}

/** Count per-step usage, or the final aggregate when a provider has no per-step events; never both. */
export function createUsageTracker(context: Pick<UsageEntry, 'provider' | 'model' | 'mode'> & { id: string }) {
  let steps = 0
  let toolCalls = 0
  const counted = { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 }
  return (raw: unknown) => {
    const chunk = object(raw)
    if (chunk.type === 'tool-call') toolCalls += 1
    if (chunk.type === 'finish-step' && chunk.usage) {
      const usage = normalizeUsage(chunk.usage)
      if (!usage.total) return
      for (const key of Object.keys(counted) as (keyof typeof counted)[]) counted[key] += usage[key]
      recordUsage({
        ...context,
        id: `${context.id}:step:${steps++}`,
        at: Date.now(),
        ...usage,
        toolCalls,
      })
      toolCalls = 0
    } else if (chunk.type === 'finish') {
      const usage = normalizeUsage(chunk.totalUsage ?? chunk.usage)
      const residual = Object.fromEntries(
        (Object.keys(counted) as (keyof typeof counted)[]).map((key) => [key, Math.max(0, usage[key] - counted[key])])
      ) as typeof counted
      recordUsage({
        ...context,
        id: steps ? `${context.id}:remaining` : context.id,
        at: Date.now(),
        ...residual,
        toolCalls,
        cacheReported: usage.cacheReported,
      })
    }
  }
}

export function aggregateUsage(entries: UsageEntry[], start: number, end: number) {
  const filtered = entries.filter((entry) => entry.at >= start && entry.at < end)
  const sum = (field: keyof Pick<UsageEntry, 'input' | 'output' | 'reasoning' | 'cached' | 'total' | 'toolCalls'>) =>
    filtered.reduce((n, entry) => n + count(entry[field]), 0)
  const daily = new Map<string, number>()
  const cacheSamples = filtered.filter((entry) => entry.cacheReported)
  const cacheInput = cacheSamples.reduce((n, entry) => n + count(entry.input), 0)
  for (const entry of filtered) {
    const date = new Date(entry.at)
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    daily.set(day, (daily.get(day) || 0) + entry.total)
  }
  return {
    input: sum('input'),
    output: sum('output'),
    reasoning: sum('reasoning'),
    cached: sum('cached'),
    total: sum('total'),
    toolCalls: sum('toolCalls'),
    requests: filtered.length,
    cacheRate: cacheInput ? cacheSamples.reduce((n, entry) => n + count(entry.cached), 0) / cacheInput : 0,
    cacheKnown: cacheSamples.length > 0,
    byMode: (['chat', 'agent', 'realtime'] as const).map((mode) => ({
      mode,
      total: filtered.filter((e) => e.mode === mode).reduce((n, e) => n + e.total, 0),
    })),
    toolRoundTokens: filtered.filter((e) => e.toolCalls > 0).reduce((n, e) => n + e.total, 0),
    daily: [...daily].sort(([a], [b]) => b.localeCompare(a)),
  }
}
