import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentUnknownPriceError,
  AgentUsageBudgetExceededError,
  AgentUsageLedger,
  type AgentUsageStorage,
  estimateAgentUsage,
} from './agent-usage-ledger'

class MemoryStorage implements AgentUsageStorage {
  private readonly values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

describe('agent usage estimator', () => {
  it('estimates payload components and keeps schema/result byte metadata', () => {
    const estimate = estimateAgentUsage({
      provider: 'openai',
      model: 'gpt-4o-mini',
      payload: { messages: [{ role: 'user', content: '打开微信' }], tools: [{ name: 'android_launch_app' }] },
      messages: [{ role: 'user', content: '打开微信' }],
      tools: [{ name: 'android_launch_app', inputSchema: { type: 'object' } }],
      results: [{ stdout: 'ok' }],
      maxOutputTokens: 128,
    })

    expect(estimate.payloadTokens).toBeGreaterThan(0)
    expect(estimate.messageTokens).toBeGreaterThan(0)
    expect(estimate.toolsTokens).toBeGreaterThan(0)
    expect(estimate.resultTokens).toBeGreaterThan(0)
    expect(estimate.inputTokens).toBeGreaterThanOrEqual(estimate.messageTokens)
    expect(estimate.outputTokens).toBe(128)
    expect(estimate.schemaBytes).toBeGreaterThan(0)
    expect(estimate.resultBytes).toBeGreaterThan(0)
    expect(estimate.reservedTokens).toBe(estimate.inputTokens + estimate.outputTokens + estimate.reasoningTokens)
  })

  it('labels the explicit fallback when the tokenizer cannot run', () => {
    const estimate = estimateAgentUsage(
      { provider: 'openai', model: 'gpt-4o-mini', messages: 'fallback text' },
      {
        tokenCounter: () => {
          throw new Error('tokenizer unavailable')
        },
      }
    )

    expect(estimate.tokenizer).toBe('fallback')
    expect(estimate.messageTokens).toBeGreaterThan(0)
  })

  it('uses the conservative DeepSeek heuristic when appropriate', () => {
    const estimate = estimateAgentUsage({ provider: 'deepseek', model: 'deepseek-chat', messages: '你好' })
    expect(estimate.tokenizer).toBe('deepseek-heuristic')
    expect(estimate.messageTokens).toBeGreaterThan(0)
  })
})

describe('AgentUsageLedger', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('reserves before the request and rejects a reservation that would exceed token budget', async () => {
    const ledger = new AgentUsageLedger({
      storage,
      tokenCounter: () => 10,
      budget: { maxTokens: 20, maxModelRequests: 3 },
    })

    const first = await ledger.reserve({
      taskId: 'task-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: 'first request',
      maxOutputTokens: 5,
    })
    expect(first.status).toBe('reserved')
    await expect(
      ledger.reserve({
        taskId: 'task-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: 'second request',
        maxOutputTokens: 5,
      })
    ).rejects.toBeInstanceOf(AgentUsageBudgetExceededError)
    await expect(ledger.list('task-1')).resolves.toHaveLength(1)
  })

  it('serializes concurrent reservations against the request-count budget', async () => {
    const ledger = new AgentUsageLedger({
      storage,
      tokenCounter: () => 1,
      budget: { maxModelRequests: 1 },
    })

    const results = await Promise.allSettled([
      ledger.reserve({ taskId: 'task-race', provider: 'p', model: 'm', messages: 'a', maxOutputTokens: 1 }),
      ledger.reserve({ taskId: 'task-race', provider: 'p', model: 'm', messages: 'b', maxOutputTokens: 1 }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('requires confirmation when pricing is unknown if configured', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const ledger = new AgentUsageLedger({
      storage,
      requirePriceConfirmation: true,
      confirmUnknownPrice: confirm,
    })

    await expect(
      ledger.reserve({
        taskId: 'task-price',
        provider: 'unknown-provider',
        model: 'unknown-model',
        messages: 'charge me only after confirmation',
      })
    ).rejects.toBeInstanceOf(AgentUnknownPriceError)
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'unknown-provider',
        model: 'unknown-model',
        reservedTokens: expect.any(Number),
      })
    )
  })

  it('settles trusted provider usage and computes cost', async () => {
    const ledger = new AgentUsageLedger({
      storage,
      priceResolver: () => ({
        inputUsdPer1k: 1,
        outputUsdPer1k: 2,
        reasoningUsdPer1k: 3,
        cachedInputUsdPer1k: 0.5,
      }),
    })
    const reservation = await ledger.reserve({
      taskId: 'task-settle',
      provider: 'priced-provider',
      model: 'priced-model',
      messages: 'request',
      maxOutputTokens: 100,
    })
    const settled = await ledger.settle(reservation.reservationId, {
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 3,
        cachedInputTokens: 2,
        totalTokens: 30,
      },
      result: { success: true },
    })

    expect(settled.status).toBe('settled')
    expect(settled.usageTrusted).toBe(true)
    expect(settled.inputTokens).toBe(10)
    expect(settled.outputTokens).toBe(20)
    expect(settled.reasoningTokens).toBe(3)
    expect(settled.resultBytes).toBeGreaterThan(0)
    expect(settled.costUsd).toBeCloseTo(0.058, 8)
  })

  it('settles missing provider usage using the reserved upper bound', async () => {
    const ledger = new AgentUsageLedger({ storage, tokenCounter: () => 7 })
    const reservation = await ledger.reserve({
      taskId: 'task-missing-usage',
      provider: 'p',
      model: 'm',
      messages: 'request',
      maxOutputTokens: 9,
      maxReasoningTokens: 2,
    })
    const settled = await ledger.settle(reservation.reservationId)

    expect(settled.usageTrusted).toBe(false)
    expect(settled.inputTokens).toBe(reservation.reservedInputTokens)
    expect(settled.outputTokens).toBe(reservation.reservedOutputTokens)
    expect(settled.reasoningTokens).toBe(reservation.reservedReasoningTokens)
  })

  it('recovers reservations left by a process death conservatively', async () => {
    let now = 1_000
    const ledger = new AgentUsageLedger({ storage, now: () => now, tokenCounter: () => 3 })
    const reservation = await ledger.reserve({
      taskId: 'task-recovery',
      provider: 'p',
      model: 'm',
      messages: 'request',
      maxOutputTokens: 4,
    })
    now = 1_001
    const recovered = await ledger.recoverPendingReservations()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      reservationId: reservation.reservationId,
      status: 'settled',
      usageTrusted: false,
    })
    await expect(ledger.list('task-recovery')).resolves.toMatchObject([
      expect.objectContaining({ status: 'settled', inputTokens: reservation.reservedInputTokens }),
    ])
  })

  it('keeps only the recent bounded history', async () => {
    let now = 1_000
    const ledger = new AgentUsageLedger({ storage, now: () => now, maxRecords: 2, retentionMs: 100 })
    await ledger.reserve({ provider: 'p', model: 'm', messages: 'old' })
    now = 1_050
    await ledger.reserve({ provider: 'p', model: 'm', messages: 'middle' })
    now = 1_100
    await ledger.reserve({ provider: 'p', model: 'm', messages: 'new' })
    expect(await ledger.list()).toHaveLength(2)
    now = 1_201
    expect(await ledger.list()).toEqual([])
  })

  it('persists request metadata and exposes an aggregate summary', async () => {
    const ledger = new AgentUsageLedger({ storage, tokenCounter: () => 2 })
    const reservation = await ledger.reserve({
      taskId: 'task-meta',
      provider: 'provider-x',
      model: 'model-y',
      requestId: 'provider-request-1',
      attempt: 2,
      messages: 'metadata',
      tools: { schema: true },
      results: { stdout: 'ok' },
      maxOutputTokens: 4,
    })
    expect(reservation).toMatchObject({
      provider: 'provider-x',
      model: 'model-y',
      requestId: 'provider-request-1',
      attempt: 2,
      schemaBytes: expect.any(Number),
      resultBytes: expect.any(Number),
      usageTrusted: false,
    })
    await ledger.settle(reservation.reservationId, { usage: null })
    await expect(ledger.summary('task-meta')).resolves.toMatchObject({
      modelRequests: 1,
      inputTokens: reservation.reservedInputTokens,
      outputTokens: 4,
    })
  })
})
