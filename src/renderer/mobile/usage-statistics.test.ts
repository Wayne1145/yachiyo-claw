import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateUsage, createUsageTracker, normalizeUsage, readUsageEntries } from './usage-statistics'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})

describe('usage statistics', () => {
  it('uses final totals when per-step usage is empty', () => {
    const track = createUsageTracker({ id: 'empty-step', provider: 'test', model: 'test', mode: 'chat' })
    track({ type: 'finish-step', usage: {} })
    track({ type: 'finish', totalUsage: { inputTokens: 10, outputTokens: 5 } })
    expect(aggregateUsage(readUsageEntries(), 0, Date.now() + 1).total).toBe(15)
  })
  it('normalizes counters without double-counting cache/reasoning subsets', () => {
    expect(
      normalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens_details: { reasoning_tokens: 10 },
      })
    ).toEqual({ input: 100, output: 20, cached: 60, reasoning: 10, total: 120, cacheReported: true })
  })
  it('records steps once and ignores the aggregate finish event', () => {
    const track = createUsageTracker({ id: 'run', provider: 'test', model: 'test', mode: 'agent' })
    track({ type: 'tool-call' })
    track({ type: 'finish-step', usage: { inputTokens: 100, outputTokens: 20 } })
    track({ type: 'finish-step', usage: { inputTokens: 120, outputTokens: 10 } })
    track({ type: 'finish', totalUsage: { inputTokens: 220, outputTokens: 30 } })
    const stats = aggregateUsage(readUsageEntries(), 0, Date.now() + 1)
    expect(stats.total).toBe(250)
    expect(stats.toolCalls).toBe(1)
    expect(stats.requests).toBe(2)
  })
  it('deduplicates identical ids and supports final-only providers', () => {
    const track = createUsageTracker({ id: 'response', provider: 'test', model: 'test', mode: 'chat' })
    track({ type: 'finish', totalUsage: { inputTokens: 10, outputTokens: 5 } })
    track({ type: 'finish', totalUsage: { inputTokens: 10, outputTokens: 5 } })
    expect(readUsageEntries()).toHaveLength(1)
  })
})
