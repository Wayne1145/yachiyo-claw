import { describe, expect, it } from 'vitest'
import { AgentBudgetExceededError, AgentBudgetTracker, mergeAgentBudget } from './agent-budget'

describe('agent budget', () => {
  it('merges safe defaults and accepts bounded overrides', () => {
    expect(mergeAgentBudget({ maxTokens: 1000, maxCostUsd: undefined })).toMatchObject({
      maxModelRequests: 3,
      maxTokens: 1000,
      maxCostUsd: undefined,
    })
  })

  it('stops additional model requests and commits at the configured limits', () => {
    const tracker = new AgentBudgetTracker({ maxModelRequests: 1, maxCommits: 1 })
    tracker.reserveModelRequest()
    expect(() => tracker.reserveModelRequest()).toThrowError(AgentBudgetExceededError)
    tracker.reserveCommit()
    expect(() => tracker.reserveCommit()).toThrowError('agent_budget_exceeded:commits')
  })

  it('stops when token or local action usage exceeds the budget', () => {
    const tracker = new AgentBudgetTracker({ maxTokens: 10, maxLocalActions: 1 })
    expect(() => tracker.recordTokens(11)).toThrowError('agent_budget_exceeded:tokens')
    tracker.reserveLocalAction()
    expect(() => tracker.reserveLocalAction()).toThrowError('agent_budget_exceeded:localActions')
  })

  it('enforces the wall-clock deadline', () => {
    const tracker = new AgentBudgetTracker({ deadlineMs: 10 }, 100)
    expect(() => tracker.assertWithinDeadline(110)).toThrowError('agent_budget_exceeded:deadline')
  })

  it('rejects non-finite or fractional limits', () => {
    expect(() => mergeAgentBudget({ maxLocalActions: Number.NaN })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ maxModelRequests: 1.5 })).toThrowError('invalid_agent_budget')
    expect(() => mergeAgentBudget({ deadlineMs: Number.POSITIVE_INFINITY })).toThrowError('invalid_agent_budget')
  })
})
