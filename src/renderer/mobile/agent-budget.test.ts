import { describe, expect, it } from 'vitest'
import { AgentBudgetTracker, mergeAgentBudget } from './agent-budget'

describe('agent budget', () => {
  it('merges safe defaults and accepts bounded overrides', () => {
    expect(mergeAgentBudget({ maxTokens: 1000, maxCostUsd: undefined })).toMatchObject({
      maxModelRequests: 12,
      maxTokens: 1000,
      maxCostUsd: undefined,
    })
  })

  it('records model requests and commits without blocking at legacy thresholds', () => {
    const tracker = new AgentBudgetTracker({ maxModelRequests: 1, maxCommits: 1 })
    tracker.reserveModelRequest()
    tracker.reserveModelRequest()
    tracker.reserveCommit()
    tracker.reserveCommit()
    expect(tracker.usage).toMatchObject({ modelRequests: 2, commits: 2 })
  })

  it('records token and local action usage without blocking', () => {
    const tracker = new AgentBudgetTracker({ maxTokens: 10, maxLocalActions: 1 })
    tracker.recordTokens(11)
    tracker.reserveLocalAction()
    tracker.reserveLocalAction()
    expect(tracker.usage).toMatchObject({ tokens: 11, localActions: 2 })
  })

  it('keeps a stable per-operation timeout without enforcing a run deadline', () => {
    const tracker = new AgentBudgetTracker({ deadlineMs: 10 }, 100)
    expect(() => tracker.assertWithinDeadline(10_000)).not.toThrow()
    expect(tracker.remainingMs).toBe(10)
  })

  it('rejects non-finite or fractional limits', () => {
    expect(() => mergeAgentBudget({ maxLocalActions: Number.NaN })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ maxModelRequests: 1.5 })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ deadlineMs: Number.POSITIVE_INFINITY })).toThrowError('invalid_agent_budget')
  })
})
