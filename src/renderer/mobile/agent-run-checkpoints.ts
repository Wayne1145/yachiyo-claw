export const AGENT_RUN_CHECKPOINT_STORAGE_KEY = 'yachiyo-agent-run-checkpoints-v1'
const MAX_RUNS = 24
const MAX_RESULT_BYTES = 32 * 1024

export type AgentRunPhase = 'preparing' | 'requesting' | 'awaiting_approval' | 'streaming' | 'completed' | 'failed'

export interface AgentRunStepCheckpoint {
  stepNumber: number
  result: unknown
  recordedAt: number
}

export interface AgentRunCheckpoint {
  schemaVersion: 1
  runId: string
  taskId: string
  assistantMessageId: string
  phase: AgentRunPhase
  currentStep: number
  pendingApproval?: { title: string; risk: 'safe' | 'dangerous'; kind: 'operation' | 'loop' }
  completedSteps: AgentRunStepCheckpoint[]
  updatedAt: number
}

interface RunCheckpointStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
}

interface Envelope {
  schemaVersion: 1
  records: AgentRunCheckpoint[]
}

async function defaultStorage(): Promise<RunCheckpointStorage> {
  return (await import('@/platform')).default
}

function isRecord(value: unknown): value is AgentRunCheckpoint {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AgentRunCheckpoint>
  return (
    item.schemaVersion === 1 &&
    typeof item.runId === 'string' &&
    typeof item.taskId === 'string' &&
    typeof item.assistantMessageId === 'string' &&
    typeof item.phase === 'string' &&
    typeof item.currentStep === 'number' &&
    Array.isArray(item.completedSteps) &&
    typeof item.updatedAt === 'number'
  )
}

function boundedResult(value: unknown): unknown {
  try {
    const json = JSON.stringify(value)
    if (json.length <= MAX_RESULT_BYTES) return JSON.parse(json)
    return { truncated: true, preview: json.slice(0, MAX_RESULT_BYTES) }
  } catch {
    return { unavailable: true }
  }
}

export class AgentRunCheckpointStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly storage?: RunCheckpointStorage) {}

  private async backend() {
    return this.storage || defaultStorage()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async listActive(): Promise<AgentRunCheckpoint[]> {
    const value = await (await this.backend()).getStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY)
    if (!value || typeof value !== 'object') return []
    const envelope = value as Partial<Envelope>
    if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.records)) return []
    return envelope.records.filter(isRecord).filter((record) => record.phase !== 'completed' && record.phase !== 'failed')
  }

  put(record: AgentRunCheckpoint): Promise<void> {
    return this.enqueue(async () => {
      const backend = await this.backend()
      const value = await backend.getStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY)
      const records =
        value && typeof value === 'object' && (value as Partial<Envelope>).schemaVersion === 1
          ? ((value as Partial<Envelope>).records || []).filter(isRecord)
          : []
      const next = records.filter((item) => item.runId !== record.runId)
      next.push(record)
      next.sort((left, right) => left.updatedAt - right.updatedAt)
      await backend.setStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY, {
        schemaVersion: 1,
        records: next.slice(-MAX_RUNS),
      } satisfies Envelope)
    })
  }

  update(runId: string, patch: Partial<Omit<AgentRunCheckpoint, 'runId' | 'schemaVersion'>>): Promise<void> {
    return this.enqueue(async () => {
      const backend = await this.backend()
      const value = await backend.getStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY)
      const records =
        value && typeof value === 'object' && (value as Partial<Envelope>).schemaVersion === 1
          ? ((value as Partial<Envelope>).records || []).filter(isRecord)
          : []
      const index = records.findIndex((item) => item.runId === runId)
      if (index < 0) return
      records[index] = { ...records[index], ...patch, updatedAt: Date.now() }
      await backend.setStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY, { schemaVersion: 1, records } satisfies Envelope)
    })
  }

  async addStepResult(runId: string, stepNumber: number, result: unknown): Promise<void> {
    await this.enqueue(async () => {
      const backend = await this.backend()
      const value = await backend.getStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY)
      const records =
        value && typeof value === 'object' && (value as Partial<Envelope>).schemaVersion === 1
          ? ((value as Partial<Envelope>).records || []).filter(isRecord)
          : []
      const index = records.findIndex((item) => item.runId === runId)
      if (index < 0) return
      const current = records[index]
      const completedSteps = current.completedSteps.filter((item) => item.stepNumber !== stepNumber)
      completedSteps.push({ stepNumber, result: boundedResult(result), recordedAt: Date.now() })
      records[index] = { ...current, phase: 'streaming', currentStep: stepNumber + 1, completedSteps, updatedAt: Date.now() }
      await backend.setStoreValue(AGENT_RUN_CHECKPOINT_STORAGE_KEY, { schemaVersion: 1, records } satisfies Envelope)
    })
  }

  async finish(runId: string, phase: 'completed' | 'failed'): Promise<void> {
    await this.update(runId, { phase, pendingApproval: undefined })
  }
}

export function createAgentRunCheckpointStore(storage?: RunCheckpointStorage) {
  return new AgentRunCheckpointStore(storage)
}
