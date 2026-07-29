export interface AgentBudget {
  /** Hard ceiling for model turns in one Agent run. */
  maxModelRequests: number
  /** Hard ceiling for accumulated model tokens. */
  maxTokens: number
  /** Hard ceiling when provider pricing is known; omitted for unpriced models. */
  maxCostUsd?: number
  /** Hard ceiling for local workspace operations. */
  maxLocalActions: number
  /** Hard ceiling for Git commits. */
  maxCommits: number
  /** Total Agent run deadline and maximum per-operation timeout. */
  deadlineMs: number
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxModelRequests: 12,
  maxTokens: 128_000,
  maxCostUsd: 2,
  maxLocalActions: 200,
  maxCommits: 1,
  deadlineMs: 10 * 60_000,
}

/** Shared request ceilings used by both the in-memory guard and the ledger. */
export const KNOWN_PRICE_AGENT_BUDGET = {
  maxCostUsd: 2,
  maxTokens: 128_000,
  maxModelRequests: 12,
  maxOutputTokens: 4096,
} as const

export const UNKNOWN_PRICE_AGENT_BUDGET = {
  maxCostUsd: undefined,
  maxTokens: 64_000,
  maxModelRequests: 8,
  maxOutputTokens: 2048,
} as const

export interface AgentBudgetUsage {
  modelRequests: number
  tokens: number
  costUsd: number
  localActions: number
  commits: number
}

export type AgentBudgetLimit = keyof Pick<
  AgentBudgetUsage,
  'modelRequests' | 'tokens' | 'costUsd' | 'localActions' | 'commits'
>

export class AgentBudgetExceededError extends Error {
  public readonly limit: AgentBudgetLimit | 'deadline'

  constructor(limit: AgentBudgetLimit | 'deadline') {
    super(`agent_budget_exceeded:${limit}`)
    this.name = 'AgentBudgetExceededError'
    this.limit = limit
  }
}

export function mergeAgentBudget(overrides?: Partial<AgentBudget>): AgentBudget {
  const next = { ...DEFAULT_AGENT_BUDGET, ...overrides }
  const positiveIntegers = [next.maxModelRequests, next.maxTokens, next.maxLocalActions, next.maxCommits]
  if (positiveIntegers.some((value) => !Number.isFinite(value) || !Number.isInteger(value) || value < 1)) {
    throw new Error('invalid_agent_budget')
  }
  if (!Number.isFinite(next.deadlineMs) || !Number.isInteger(next.deadlineMs) || next.deadlineMs < 1) {
    throw new Error('invalid_agent_budget')
  }
  if (next.maxCostUsd !== undefined && (!Number.isFinite(next.maxCostUsd) || next.maxCostUsd < 0)) {
    throw new Error('invalid_agent_budget')
  }
  return next
}

export class AgentBudgetTracker {
  public readonly budget: AgentBudget
  public readonly startedAt: number
  private usageState: AgentBudgetUsage = {
    modelRequests: 0,
    tokens: 0,
    costUsd: 0,
    localActions: 0,
    commits: 0,
  }

  constructor(budget?: Partial<AgentBudget>, now = Date.now()) {
    this.budget = mergeAgentBudget(budget)
    this.startedAt = now
  }

  get usage(): AgentBudgetUsage {
    return { ...this.usageState }
  }

  get remainingMs(): number {
    return Math.max(0, this.startedAt + this.budget.deadlineMs - Date.now())
  }

  assertWithinDeadline(now = Date.now()): void {
    if (now - this.startedAt >= this.budget.deadlineMs) throw new AgentBudgetExceededError('deadline')
  }

  reserveModelRequest(now = Date.now()): void {
    this.assertWithinDeadline(now)
    if (this.usageState.modelRequests >= this.budget.maxModelRequests) throw new AgentBudgetExceededError('modelRequests')
    this.usageState.modelRequests += 1
  }

  recordTokens(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) return
    if (this.usageState.tokens + tokens > this.budget.maxTokens) throw new AgentBudgetExceededError('tokens')
    this.usageState.tokens += tokens
  }

  recordCost(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return
    if (this.budget.maxCostUsd !== undefined && this.usageState.costUsd + costUsd > this.budget.maxCostUsd) {
      throw new AgentBudgetExceededError('costUsd')
    }
    this.usageState.costUsd += costUsd
  }

  reserveLocalAction(now = Date.now()): void {
    this.assertWithinDeadline(now)
    if (this.usageState.localActions >= this.budget.maxLocalActions) throw new AgentBudgetExceededError('localActions')
    this.usageState.localActions += 1
  }

  reserveCommit(now = Date.now()): void {
    this.assertWithinDeadline(now)
    if (this.usageState.commits >= this.budget.maxCommits) throw new AgentBudgetExceededError('commits')
    this.usageState.commits += 1
  }
}
