import { Tiktoken } from 'js-tiktoken/lite'

// @ts-ignore The ranks package ships JSON data without a TypeScript declaration.
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

export const AGENT_USAGE_LEDGER_STORAGE_KEY = 'yachiyo-agent-usage-ledger-v1'
export const AGENT_USAGE_LEDGER_SCHEMA_VERSION = 1 as const
export const AGENT_USAGE_LEDGER_MAX_RECORDS = 500
export const AGENT_USAGE_LEDGER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_AGENT_OUTPUT_TOKEN_RESERVATION = 512

export type AgentUsageTokenizer = 'js-tiktoken' | 'deepseek-heuristic' | 'fallback'
export type AgentUsageRecordStatus = 'reserved' | 'settled' | 'released'
export type AgentUsageBudgetLimit = 'tokens' | 'costUsd' | 'modelRequests'

export interface AgentUsageStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
}

export interface AgentUsageModel {
  provider: string
  model: string
}

/** Prices are expressed in USD per 1,000 tokens. Missing rates mean unknown pricing. */
export interface AgentUsagePrice {
  inputUsdPer1k?: number
  outputUsdPer1k?: number
  reasoningUsdPer1k?: number
  cachedInputUsdPer1k?: number
}

export type AgentUsagePriceResolver = (
  provider: string,
  model: string
) => AgentUsagePrice | undefined | Promise<AgentUsagePrice | undefined>

/** Small explicit price table used only for preflight budgeting. Unknown models
 * intentionally return undefined and must be confirmed before a request. */
export function resolveDefaultAgentPrice(provider: string, model: string): AgentUsagePrice | undefined {
  const key = `${provider}/${model}`.toLowerCase()
  if (key.includes('gpt-4o-mini')) return { inputUsdPer1k: 0.00015, outputUsdPer1k: 0.0006 }
  if (key.includes('gpt-4o')) return { inputUsdPer1k: 0.005, outputUsdPer1k: 0.015 }
  if (key.includes('gpt-5')) return { inputUsdPer1k: 0.005, outputUsdPer1k: 0.015 }
  if (key.includes('deepseek-chat')) return { inputUsdPer1k: 0.00027, outputUsdPer1k: 0.0011 }
  if (key.includes('gemini-2.0-flash') || key.includes('gemini-2.5-flash')) {
    return { inputUsdPer1k: 0.0003, outputUsdPer1k: 0.0025 }
  }
  if (key.includes('claude-3-5-sonnet') || key.includes('claude-3.7-sonnet')) {
    return { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015 }
  }
  return undefined
}

export interface UnknownPriceConfirmationInput extends AgentUsageModel {
  requestId: string
  attempt: number
  reservedTokens: number
  estimatedCostUsd?: number
}

export type UnknownPriceConfirmationHook = (input: UnknownPriceConfirmationInput) => boolean | Promise<boolean>

export interface AgentUsageBudget {
  maxTokens?: number
  maxCostUsd?: number
  maxModelRequests?: number
}

export interface AgentUsageEstimateInput {
  /** The complete request payload, when available. */
  payload?: unknown
  /** Model messages sent to the provider. */
  messages?: unknown
  /** Tool definitions/schema sent to the provider. */
  tools?: unknown
  /** Tool results or other prior observations included in the prompt. */
  results?: unknown
  /** An explicit schema payload; defaults to the serialized tools. */
  schema?: unknown
  /** Output cap used for the pre-request reservation. */
  maxOutputTokens?: number
  /** Optional separate reasoning reservation for providers that bill it independently. */
  maxReasoningTokens?: number
  /** Cached input tokens expected for this request, when known. */
  cachedInputTokens?: number
  /** Override when the result is not serializable or has already been measured. */
  resultBytes?: number
}

export interface AgentUsageEstimate {
  payloadTokens: number
  messageTokens: number
  toolsTokens: number
  resultTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedInputTokens: number
  schemaBytes: number
  resultBytes: number
  reservedTokens: number
  tokenizer: AgentUsageTokenizer
}

export interface AgentUsageReservationInput extends AgentUsageEstimateInput, AgentUsageModel {
  taskId?: string
  requestId?: string
  attempt?: number
  budget?: AgentUsageBudget
  price?: AgentUsagePrice
}

export interface AgentProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  costUsd?: number
}

export interface AgentUsageSettlementInput {
  usage?: AgentProviderUsage | Record<string, unknown> | null
  /** A provider request id can replace the locally generated id. */
  requestId?: string
  /** Result data is used only for byte/token accounting, never persisted verbatim. */
  result?: unknown
  resultBytes?: number
  costUsd?: number
  price?: AgentUsagePrice
}

export interface AgentUsageRecord {
  schemaVersion: typeof AGENT_USAGE_LEDGER_SCHEMA_VERSION
  reservationId: string
  taskId?: string
  provider: string
  model: string
  requestId: string
  attempt: number
  status: AgentUsageRecordStatus
  reservedAt: number
  settledAt?: number

  // Estimated component counts are retained so a missing provider usage can
  // be settled conservatively without replaying the request payload.
  payloadTokens: number
  messageTokens: number
  toolsTokens: number
  resultTokens: number
  reservedInputTokens: number
  reservedOutputTokens: number
  reservedReasoningTokens: number
  reservedCachedInputTokens: number
  reservedTokens: number

  // Final usage fields. While a record is reserved these equal the estimates.
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedInputTokens: number
  schemaBytes: number
  resultBytes: number
  tokenizer: AgentUsageTokenizer
  estimatedCostUsd?: number
  costUsd?: number
  usageTrusted: boolean
}

export interface AgentUsageSummary {
  modelRequests: number
  reservedTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedInputTokens: number
  costUsd: number
  unknownCostRecords: number
}

export class AgentUsageBudgetExceededError extends Error {
  public readonly limit: AgentUsageBudgetLimit

  constructor(limit: AgentUsageBudgetLimit) {
    super(`agent_usage_budget_exceeded:${limit}`)
    this.name = 'AgentUsageBudgetExceededError'
    this.limit = limit
  }
}

export class AgentUnknownPriceError extends Error {
  public readonly provider: string
  public readonly model: string

  constructor(provider: string, model: string) {
    super(`agent_usage_price_confirmation_required:${provider}/${model}`)
    this.name = 'AgentUnknownPriceError'
    this.provider = provider
    this.model = model
  }
}

interface AgentUsageLedgerEnvelope {
  schemaVersion: typeof AGENT_USAGE_LEDGER_SCHEMA_VERSION
  records: AgentUsageRecord[]
}

export interface AgentUsageLedgerOptions {
  storage?: AgentUsageStorage
  storageKey?: string
  now?: () => number
  maxRecords?: number
  retentionMs?: number
  budget?: AgentUsageBudget
  priceResolver?: AgentUsagePriceResolver
  confirmUnknownPrice?: UnknownPriceConfirmationHook
  /** Keep unknown-price reservations allowed unless explicitly enabled. */
  requirePriceConfirmation?: boolean
  /** Test/host override. A throwing counter falls back to the documented heuristic. */
  tokenCounter?: (text: string, model: AgentUsageModel) => number
}

let encoder: Tiktoken | null = null

function getEncoder(): Tiktoken {
  if (!encoder) encoder = new Tiktoken(cl100kBase)
  return encoder
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : fallback
}

function modelIsDeepSeek(model: AgentUsageModel): boolean {
  return model.model.toLowerCase().includes('deepseek')
}

function estimateDeepSeekTokens(text: string): number {
  if (!text) return 0
  let total = 0
  let previousSpace = false
  for (const character of text) {
    if (/[一-鿿㐀-䶿 0-⾡f]/u.test(character)) {
      total += 0.6
      previousSpace = false
    } else if (/\s/u.test(character)) {
      if (!previousSpace) total += 1
      previousSpace = true
    } else {
      total += 0.3
      previousSpace = false
    }
  }
  return Math.max(1, Math.ceil(total))
}

function utf8Bytes(value: string): number {
  try {
    return new TextEncoder().encode(value).byteLength
  } catch {
    return value.length
  }
}

function fallbackTokens(value: string): number {
  if (!value) return 0
  // Deliberately conservative when the WASM/JSON tokenizer cannot load.
  return Math.max(1, Math.ceil(Math.max([...value].length / 4, utf8Bytes(value) / 2)))
}

function serializeForEstimate(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(value, (_key, candidate: unknown) => {
        if (typeof candidate === 'bigint') return `${candidate}n`
        if (typeof candidate === 'function') return `[function ${candidate.name || 'anonymous'}]`
        if (!candidate || typeof candidate !== 'object') return candidate
        if (seen.has(candidate)) return '[Circular]'
        seen.add(candidate)
        return candidate
      }) || ''
    )
  } catch {
    return String(value)
  }
}

function countText(
  text: string,
  model: AgentUsageModel,
  counter?: AgentUsageLedgerOptions['tokenCounter']
): {
  tokens: number
  tokenizer: AgentUsageTokenizer
} {
  if (!text) return { tokens: 0, tokenizer: 'js-tiktoken' }
  try {
    if (counter) {
      const tokens = counter(text, model)
      if (Number.isFinite(tokens) && tokens >= 0) {
        return { tokens: Math.ceil(tokens), tokenizer: 'js-tiktoken' }
      }
      throw new Error('invalid_token_counter_result')
    }
    if (modelIsDeepSeek(model)) {
      return { tokens: estimateDeepSeekTokens(text), tokenizer: 'deepseek-heuristic' }
    }
    return { tokens: getEncoder().encode(text).length, tokenizer: 'js-tiktoken' }
  } catch {
    return { tokens: fallbackTokens(text), tokenizer: 'fallback' }
  }
}

function mergeTokenizer(left: AgentUsageTokenizer, right: AgentUsageTokenizer): AgentUsageTokenizer {
  if (left === 'fallback' || right === 'fallback') return 'fallback'
  if (left === 'deepseek-heuristic' || right === 'deepseek-heuristic') return 'deepseek-heuristic'
  return 'js-tiktoken'
}

function rate(value: unknown): number | undefined {
  return isFiniteNonNegative(value) ? value : undefined
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  cachedInputTokens: number,
  price: AgentUsagePrice | undefined
): number | undefined {
  if (!price) return undefined
  const inputRate = rate(price.inputUsdPer1k)
  const outputRate = rate(price.outputUsdPer1k)
  const reasoningRate = rate(price.reasoningUsdPer1k) ?? outputRate
  const cachedRate = rate(price.cachedInputUsdPer1k) ?? inputRate
  const cached = Math.min(Math.max(cachedInputTokens, 0), Math.max(inputTokens, 0))
  const uncached = Math.max(inputTokens - cached, 0)
  if ((uncached > 0 && inputRate === undefined) || (cached > 0 && cachedRate === undefined)) return undefined
  if (outputTokens > 0 && outputRate === undefined) return undefined
  if (reasoningTokens > 0 && reasoningRate === undefined) return undefined
  return (
    (uncached * (inputRate || 0) +
      cached * (cachedRate || 0) +
      outputTokens * (outputRate || 0) +
      reasoningTokens * (reasoningRate || 0)) /
    1000
  )
}

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

function parseNumber(value: unknown): number | undefined {
  return isFiniteNonNegative(value) ? value : undefined
}

function parseRecord(value: unknown): AgentUsageRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AgentUsageRecord>
  if (
    candidate.schemaVersion !== AGENT_USAGE_LEDGER_SCHEMA_VERSION ||
    typeof candidate.reservationId !== 'string' ||
    typeof candidate.provider !== 'string' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.requestId !== 'string' ||
    !['reserved', 'settled', 'released'].includes(candidate.status || '')
  ) {
    return null
  }
  const numericFields = [
    'attempt',
    'reservedAt',
    'payloadTokens',
    'messageTokens',
    'toolsTokens',
    'resultTokens',
    'reservedInputTokens',
    'reservedOutputTokens',
    'reservedReasoningTokens',
    'reservedCachedInputTokens',
    'reservedTokens',
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'cachedInputTokens',
    'schemaBytes',
    'resultBytes',
  ] as const
  if (numericFields.some((field) => !isFiniteNonNegative(candidate[field]))) return null
  if (typeof candidate.attempt !== 'number' || !Number.isInteger(candidate.attempt) || candidate.attempt < 1)
    return null
  if (candidate.settledAt !== undefined && !isFiniteNonNegative(candidate.settledAt)) return null
  if (candidate.estimatedCostUsd !== undefined && !isFiniteNonNegative(candidate.estimatedCostUsd)) return null
  if (candidate.costUsd !== undefined && !isFiniteNonNegative(candidate.costUsd)) return null
  if (!['js-tiktoken', 'deepseek-heuristic', 'fallback'].includes(candidate.tokenizer || '')) return null
  if (typeof candidate.usageTrusted !== 'boolean') return null
  return candidate as AgentUsageRecord
}

function parseEnvelope(value: unknown): AgentUsageLedgerEnvelope {
  if (!value || typeof value !== 'object') return { schemaVersion: AGENT_USAGE_LEDGER_SCHEMA_VERSION, records: [] }
  const candidate = value as Partial<AgentUsageLedgerEnvelope>
  if (candidate.schemaVersion !== AGENT_USAGE_LEDGER_SCHEMA_VERSION || !Array.isArray(candidate.records)) {
    return { schemaVersion: AGENT_USAGE_LEDGER_SCHEMA_VERSION, records: [] }
  }
  return {
    schemaVersion: AGENT_USAGE_LEDGER_SCHEMA_VERSION,
    records: candidate.records.map(parseRecord).filter((record): record is AgentUsageRecord => record !== null),
  }
}

function localStorageAdapter(): AgentUsageStorage {
  const memory = new Map<string, unknown>()
  return {
    getStoreValue(key) {
      if (typeof globalThis.localStorage !== 'undefined') {
        try {
          const value = globalThis.localStorage.getItem(key)
          return Promise.resolve(value ? JSON.parse(value) : null)
        } catch {
          return Promise.resolve(null)
        }
      }
      return Promise.resolve(memory.get(key) ?? null)
    },
    setStoreValue(key, value) {
      if (typeof globalThis.localStorage !== 'undefined') {
        globalThis.localStorage.setItem(key, JSON.stringify(value))
      } else {
        memory.set(key, value)
      }
      return Promise.resolve()
    },
  }
}

async function loadDefaultStorage(): Promise<AgentUsageStorage> {
  try {
    const platform = await import('@/platform')
    const candidate: unknown = platform.default
    if (
      candidate &&
      typeof (candidate as AgentUsageStorage).getStoreValue === 'function' &&
      typeof (candidate as AgentUsageStorage).setStoreValue === 'function'
    ) {
      return candidate as AgentUsageStorage
    }
  } catch {
    // Unit tests and a bare web context may not expose the platform adapter.
  }
  return localStorageAdapter()
}

function pruneRecords(
  records: AgentUsageRecord[],
  now: number,
  maxRecords: number,
  retentionMs: number
): AgentUsageRecord[] {
  const cutoff = now - retentionMs
  return records
    .filter((record) => (record.settledAt ?? record.reservedAt) >= cutoff)
    .sort((left, right) => (left.settledAt ?? left.reservedAt) - (right.settledAt ?? right.reservedAt))
    .slice(-maxRecords)
}

function usageField(value: unknown, nested?: unknown): number | undefined {
  return parseNumber(value) ?? parseNumber(nested)
}

function normalizeProviderUsage(usage: AgentProviderUsage | Record<string, unknown> | null | undefined): {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  costUsd?: number
  complete: boolean
} {
  if (!usage || typeof usage !== 'object') {
    return { complete: false }
  }
  const candidate = usage as Record<string, unknown>
  const inputDetails = candidate.inputTokenDetails as Record<string, unknown> | undefined
  const outputDetails = candidate.outputTokenDetails as Record<string, unknown> | undefined
  const inputTokens = usageField(candidate.inputTokens)
  const outputTokens = usageField(candidate.outputTokens)
  const reasoningTokens = usageField(candidate.reasoningTokens, outputDetails?.reasoningTokens)
  const cachedInputTokens = usageField(candidate.cachedInputTokens, inputDetails?.cacheReadTokens)
  const costUsd = usageField(candidate.costUsd, candidate.cost)
  const totalTokens = parseNumber(candidate.totalTokens)
  const complete =
    inputTokens !== undefined && outputTokens !== undefined && (totalTokens === undefined || totalTokens >= 0)
  return { inputTokens, outputTokens, reasoningTokens, cachedInputTokens, costUsd, complete }
}

function estimateForInput(
  input: AgentUsageEstimateInput & AgentUsageModel,
  counter?: AgentUsageLedgerOptions['tokenCounter']
): AgentUsageEstimate {
  const payloadText = serializeForEstimate(input.payload)
  const messagesText = serializeForEstimate(input.messages)
  const toolsText = serializeForEstimate(input.tools)
  const resultsText = serializeForEstimate(input.results)
  const schemaText = serializeForEstimate(input.schema === undefined ? input.tools : input.schema)
  const payloadCount = countText(payloadText, input, counter)
  const messageCount = countText(messagesText, input, counter)
  const toolsCount = countText(toolsText, input, counter)
  const resultCount = countText(resultsText, input, counter)
  const componentTokens = messageCount.tokens + toolsCount.tokens + resultCount.tokens
  const inputTokens = Math.max(payloadCount.tokens, componentTokens)
  const outputTokens = positiveInteger(input.maxOutputTokens, DEFAULT_AGENT_OUTPUT_TOKEN_RESERVATION)
  const reasoningTokens = nonNegativeInteger(input.maxReasoningTokens)
  const cachedInputTokens = Math.min(nonNegativeInteger(input.cachedInputTokens), inputTokens)
  const schemaBytes = utf8Bytes(schemaText)
  const resultBytes = isFiniteNonNegative(input.resultBytes) ? input.resultBytes : utf8Bytes(resultsText)
  return {
    payloadTokens: payloadCount.tokens,
    messageTokens: messageCount.tokens,
    toolsTokens: toolsCount.tokens,
    resultTokens: resultCount.tokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    schemaBytes,
    resultBytes,
    reservedTokens: inputTokens + outputTokens + reasoningTokens,
    tokenizer: mergeTokenizer(
      mergeTokenizer(payloadCount.tokenizer, messageCount.tokenizer),
      mergeTokenizer(toolsCount.tokenizer, resultCount.tokenizer)
    ),
  }
}

export function estimateAgentUsage(
  input: AgentUsageEstimateInput & AgentUsageModel,
  options: Pick<AgentUsageLedgerOptions, 'tokenCounter'> = {}
): AgentUsageEstimate {
  return estimateForInput(input, options.tokenCounter)
}

export class AgentUsageLedger {
  private storage: AgentUsageStorage | null
  private readonly storageKey: string
  private readonly now: () => number
  private readonly maxRecords: number
  private readonly retentionMs: number
  private readonly budget?: AgentUsageBudget
  private readonly priceResolver?: AgentUsagePriceResolver
  private readonly confirmUnknownPrice?: UnknownPriceConfirmationHook
  private readonly requirePriceConfirmation: boolean
  private readonly tokenCounter?: AgentUsageLedgerOptions['tokenCounter']
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(options: AgentUsageLedgerOptions = {}) {
    this.storage = options.storage || null
    this.storageKey = options.storageKey || AGENT_USAGE_LEDGER_STORAGE_KEY
    this.now = options.now || (() => Date.now())
    this.maxRecords = positiveInteger(options.maxRecords, AGENT_USAGE_LEDGER_MAX_RECORDS)
    this.retentionMs = positiveInteger(options.retentionMs, AGENT_USAGE_LEDGER_RETENTION_MS)
    this.budget = options.budget
    this.priceResolver = options.priceResolver
    this.confirmUnknownPrice = options.confirmUnknownPrice
    this.requirePriceConfirmation = options.requirePriceConfirmation === true
    this.tokenCounter = options.tokenCounter
  }

  private async getStorage(): Promise<AgentUsageStorage> {
    if (!this.storage) this.storage = await loadDefaultStorage()
    return this.storage
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async readRecords(): Promise<AgentUsageRecord[]> {
    const value = await (await this.getStorage()).getStoreValue(this.storageKey)
    return parseEnvelope(value).records
  }

  private async writeRecords(records: AgentUsageRecord[]): Promise<void> {
    await (await this.getStorage()).setStoreValue(this.storageKey, {
      schemaVersion: AGENT_USAGE_LEDGER_SCHEMA_VERSION,
      records: pruneRecords(records, this.now(), this.maxRecords, this.retentionMs),
    } satisfies AgentUsageLedgerEnvelope)
  }

  private recordsForTask(records: AgentUsageRecord[], taskId?: string): AgentUsageRecord[] {
    return records.filter(
      (record) => (record.taskId || '__global__') === (taskId || '__global__') && record.status !== 'released'
    )
  }

  private async resolvePrice(
    provider: string,
    model: string,
    override?: AgentUsagePrice
  ): Promise<AgentUsagePrice | undefined> {
    if (override) return override
    return await this.priceResolver?.(provider, model)
  }

  async reserve(input: AgentUsageReservationInput): Promise<AgentUsageRecord> {
    const provider = input.provider.trim()
    const model = input.model.trim()
    if (!provider || !model) throw new Error('agent_usage_provider_model_required')
    const attempt = positiveInteger(input.attempt, 1)
    const requestId = input.requestId?.trim() || createId('request')
    const estimate = estimateForInput({ ...input, provider, model }, this.tokenCounter)
    const budget = input.budget || this.budget
    const price = await this.resolvePrice(provider, model, input.price)
    const estimatedCostUsd = calculateCost(
      estimate.inputTokens,
      estimate.outputTokens,
      estimate.reasoningTokens,
      estimate.cachedInputTokens,
      price
    )

    return this.enqueue(async () => {
      const records = pruneRecords(await this.readRecords(), this.now(), this.maxRecords, this.retentionMs)
      const taskRecords = this.recordsForTask(records, input.taskId)
      const usedRequests = taskRecords.length
      const usedTokens = taskRecords.reduce(
        (total, record) => total + record.inputTokens + record.outputTokens + record.reasoningTokens,
        0
      )
      const usedCost = taskRecords.reduce(
        (total, record) => total + (record.costUsd ?? record.estimatedCostUsd ?? 0),
        0
      )

      if (budget?.maxModelRequests !== undefined && usedRequests + 1 > budget.maxModelRequests) {
        throw new AgentUsageBudgetExceededError('modelRequests')
      }
      if (budget?.maxTokens !== undefined && usedTokens + estimate.reservedTokens > budget.maxTokens) {
        throw new AgentUsageBudgetExceededError('tokens')
      }
      if (
        budget?.maxCostUsd !== undefined &&
        estimatedCostUsd !== undefined &&
        usedCost + estimatedCostUsd > budget.maxCostUsd
      ) {
        throw new AgentUsageBudgetExceededError('costUsd')
      }

      if (estimatedCostUsd === undefined && (this.requirePriceConfirmation || this.confirmUnknownPrice)) {
        const confirmed = await this.confirmUnknownPrice?.({
          provider,
          model,
          requestId,
          attempt,
          reservedTokens: estimate.reservedTokens,
        })
        if (!confirmed) throw new AgentUnknownPriceError(provider, model)
      }

      const record: AgentUsageRecord = {
        schemaVersion: AGENT_USAGE_LEDGER_SCHEMA_VERSION,
        reservationId: createId('usage'),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        provider,
        model,
        requestId,
        attempt,
        status: 'reserved',
        reservedAt: this.now(),
        payloadTokens: estimate.payloadTokens,
        messageTokens: estimate.messageTokens,
        toolsTokens: estimate.toolsTokens,
        resultTokens: estimate.resultTokens,
        reservedInputTokens: estimate.inputTokens,
        reservedOutputTokens: estimate.outputTokens,
        reservedReasoningTokens: estimate.reasoningTokens,
        reservedCachedInputTokens: estimate.cachedInputTokens,
        reservedTokens: estimate.reservedTokens,
        inputTokens: estimate.inputTokens,
        outputTokens: estimate.outputTokens,
        reasoningTokens: estimate.reasoningTokens,
        cachedInputTokens: estimate.cachedInputTokens,
        schemaBytes: estimate.schemaBytes,
        resultBytes: estimate.resultBytes,
        tokenizer: estimate.tokenizer,
        ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
        usageTrusted: false,
      }
      await this.writeRecords([...records, record])
      return record
    })
  }

  settle(reservationId: string, input: AgentUsageSettlementInput = {}): Promise<AgentUsageRecord> {
    return this.enqueue(async () => {
      const records = pruneRecords(await this.readRecords(), this.now(), this.maxRecords, this.retentionMs)
      const index = records.findIndex((record) => record.reservationId === reservationId)
      if (index < 0) throw new Error('agent_usage_reservation_not_found')
      const existing = records[index]
      if (existing.status === 'settled') return existing
      if (existing.status === 'released') throw new Error('agent_usage_reservation_released')

      const normalized = normalizeProviderUsage(input.usage)
      // Provider usage is the authoritative billing measurement even when the
      // local tokenizer estimate was low; subsequent reservations use these
      // settled values so an estimate miss cannot reopen the budget.
      const usageTrusted = normalized.complete
      const resultText = input.result === undefined ? '' : serializeForEstimate(input.result)
      const resultBytes = isFiniteNonNegative(input.resultBytes)
        ? input.resultBytes
        : resultText
          ? utf8Bytes(resultText)
          : existing.resultBytes
      const inputTokens = normalized.inputTokens ?? existing.reservedInputTokens
      const outputTokens = normalized.outputTokens ?? existing.reservedOutputTokens
      const reasoningTokens = normalized.reasoningTokens ?? existing.reservedReasoningTokens
      const cachedInputTokens = Math.min(
        normalized.cachedInputTokens ?? existing.reservedCachedInputTokens,
        inputTokens
      )
      const price = await this.resolvePrice(existing.provider, existing.model, input.price)
      const calculatedCost = calculateCost(inputTokens, outputTokens, reasoningTokens, cachedInputTokens, price)
      const explicitCost = parseNumber(input.costUsd) ?? normalized.costUsd
      const costUsd = explicitCost ?? calculatedCost
      const settled: AgentUsageRecord = {
        ...existing,
        ...(input.requestId?.trim() ? { requestId: input.requestId.trim() } : {}),
        status: 'settled',
        settledAt: this.now(),
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedInputTokens,
        resultBytes,
        ...(costUsd !== undefined ? { costUsd } : {}),
        usageTrusted,
      }
      records[index] = settled
      await this.writeRecords(records)
      return settled
    })
  }

  release(reservationId: string): Promise<AgentUsageRecord> {
    return this.enqueue(async () => {
      const records = pruneRecords(await this.readRecords(), this.now(), this.maxRecords, this.retentionMs)
      const index = records.findIndex((record) => record.reservationId === reservationId)
      if (index < 0) throw new Error('agent_usage_reservation_not_found')
      const existing = records[index]
      if (existing.status === 'released') return existing
      if (existing.status === 'settled') return existing
      const released = { ...existing, status: 'released' as const, settledAt: this.now(), usageTrusted: false }
      records[index] = released
      await this.writeRecords(records)
      return released
    })
  }

  /**
   * Conservatively closes reservations left by a renderer/process death.
   * No provider usage is available in this case, so the reserved upper bound
   * is retained and marked untrusted instead of allowing an unbounded retry.
   */
  recoverPendingReservations(beforeAt = this.now(), taskId?: string, minAgeMs = taskId ? 60_000 : 0): Promise<AgentUsageRecord[]> {
    return this.enqueue(async () => {
      const records = pruneRecords(await this.readRecords(), this.now(), this.maxRecords, this.retentionMs)
      const recovered: AgentUsageRecord[] = []
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]
        if (
          record.status !== 'reserved' ||
          (taskId !== undefined && record.taskId !== taskId) ||
          record.reservedAt > beforeAt - Math.max(0, minAgeMs)
        )
          continue
        const settled: AgentUsageRecord = {
          ...record,
          status: 'settled',
          settledAt: this.now(),
          inputTokens: record.reservedInputTokens,
          outputTokens: record.reservedOutputTokens,
          reasoningTokens: record.reservedReasoningTokens,
          cachedInputTokens: record.reservedCachedInputTokens,
          usageTrusted: false,
        }
        records[index] = settled
        recovered.push(settled)
      }
      if (recovered.length > 0) await this.writeRecords(records)
      return recovered
    })
  }

  list(taskId?: string): Promise<AgentUsageRecord[]> {
    return this.enqueue(async () => {
      const rawRecords = await this.readRecords()
      const records = pruneRecords(rawRecords, this.now(), this.maxRecords, this.retentionMs)
      if (records.length !== rawRecords.length) await this.writeRecords(records)
      return taskId === undefined ? records : records.filter((record) => record.taskId === taskId)
    })
  }

  async summary(taskId?: string): Promise<AgentUsageSummary> {
    const records = (await this.list(taskId)).filter((record) => record.status !== 'released')
    return records.reduce<AgentUsageSummary>(
      (summary, record) => ({
        modelRequests: summary.modelRequests + 1,
        reservedTokens: summary.reservedTokens + record.reservedTokens,
        inputTokens: summary.inputTokens + record.inputTokens,
        outputTokens: summary.outputTokens + record.outputTokens,
        reasoningTokens: summary.reasoningTokens + record.reasoningTokens,
        cachedInputTokens: summary.cachedInputTokens + record.cachedInputTokens,
        costUsd: summary.costUsd + (record.costUsd ?? record.estimatedCostUsd ?? 0),
        unknownCostRecords:
          summary.unknownCostRecords + (record.costUsd === undefined && record.estimatedCostUsd === undefined ? 1 : 0),
      }),
      {
        modelRequests: 0,
        reservedTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        unknownCostRecords: 0,
      }
    )
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await this.writeRecords([])
    })
  }
}

export function createAgentUsageLedger(options: AgentUsageLedgerOptions = {}): AgentUsageLedger {
  return new AgentUsageLedger(options)
}
