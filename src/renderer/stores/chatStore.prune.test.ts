import { describe, expect, it } from 'vitest'
import { shouldPruneSession } from './sessionPrune'

const draft = (over: Record<string, unknown> = {}) => ({ messages: [{ role: 'system' }], ...over })

describe('shouldPruneSession', () => {
  it('prunes a stale draft that only has a system prompt', () => {
    expect(shouldPruneSession(draft())).toBe(true)
  })

  it('treats an empty messages array as prunable', () => {
    expect(shouldPruneSession({ messages: [] })).toBe(true)
  })

  it('keeps a session with a user message', () => {
    expect(shouldPruneSession(draft({ messages: [{ role: 'system' }, { role: 'user' }] }))).toBe(false)
  })

  it('keeps a session with an assistant message', () => {
    expect(shouldPruneSession(draft({ messages: [{ role: 'assistant' }] }))).toBe(false)
  })

  it('keeps a starred (favorited) empty session', () => {
    expect(shouldPruneSession(draft({ starred: true }))).toBe(false)
  })

  it('keeps an empty session that has fork branches', () => {
    expect(shouldPruneSession(draft({ threads: [{ id: 'branch-1' }] }))).toBe(false)
  })

  it('keeps a protected (scheduled-task-linked) session', () => {
    expect(shouldPruneSession(draft(), true)).toBe(false)
  })

  it('never deletes a session it cannot load', () => {
    expect(shouldPruneSession(null)).toBe(false)
    expect(shouldPruneSession(undefined)).toBe(false)
  })
})
