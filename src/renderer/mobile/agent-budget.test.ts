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

  it('stops model requests and commits at their hard ceilings', () => {
    const tracker = new AgentBudgetTracker({ maxModelRequests: 1, maxCommits: 1 })
    tracker.reserveModelRequest()
    tracker.reserveCommit()
    expect(() => tracker.reserveModelRequest()).toThrowError('agent_budget_exceeded:modelRequests')
    expect(() => tracker.reserveCommit()).toThrowError('agent_budget_exceeded:commits')
    expect(tracker.usage).toMatchObject({ modelRequests: 1, commits: 1 })
  })

  it('stops token and local action usage at their hard ceilings', () => {
    const tracker = new AgentBudgetTracker({ maxTokens: 10, maxLocalActions: 1 })
    tracker.recordTokens(10)
    tracker.reserveLocalAction()
    expect(() => tracker.recordTokens(1)).toThrowError('agent_budget_exceeded:tokens')
    expect(() => tracker.reserveLocalAction()).toThrowError('agent_budget_exceeded:localActions')
    expect(tracker.usage).toMatchObject({ tokens: 10, localActions: 1 })
  })

  it('enforces the total run deadline', () => {
    const tracker = new AgentBudgetTracker({ deadlineMs: 10 }, 100)
    expect(() => tracker.assertWithinDeadline(109)).not.toThrow()
    expect(() => tracker.assertWithinDeadline(110)).toThrowError('agent_budget_exceeded:deadline')
  })

  it('rejects non-finite or fractional limits', () => {
    expect(() => mergeAgentBudget({ maxLocalActions: Number.NaN })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ maxModelRequests: 1.5 })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ deadlineMs: Number.POSITIVE_INFINITY })).toThrowError('invalid_agent_budget')
  })
})
