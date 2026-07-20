import { type ExecutionCheckpoint, ExecutionCheckpointSchema } from '@shared/agent'

export const AGENT_CHECKPOINT_STORAGE_KEY = 'yachiyo-agent-execution-checkpoints-v1'
const MAX_TERMINAL_CHECKPOINTS_PER_TASK = 256
const TERMINAL_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface AgentCheckpointStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
}

interface CheckpointEnvelope {
  schemaVersion: 1
  records: ExecutionCheckpoint[]
}

function parseEnvelope(value: unknown): CheckpointEnvelope {
  if (!value || typeof value !== 'object') return { schemaVersion: 1, records: [] }
  const candidate = value as Partial<CheckpointEnvelope>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.records)) {
    return { schemaVersion: 1, records: [] }
  }
  const records = candidate.records
    .map((record) => ExecutionCheckpointSchema.safeParse(record))
    .filter((result): result is { success: true; data: ExecutionCheckpoint } => result.success)
    .map((result) => result.data)
  return { schemaVersion: 1, records }
}

async function loadDefaultStorage(): Promise<AgentCheckpointStorage> {
  const module = await import('@/platform')
  return module.default as AgentCheckpointStorage
}

function checkpointKey(record: Pick<ExecutionCheckpoint, 'taskId' | 'stepId' | 'callId'>): string {
  return `${record.taskId}\u0000${record.stepId}\u0000${record.callId}`
}

function compactCheckpoints(records: ExecutionCheckpoint[], now: number): ExecutionCheckpoint[] {
  const protectedRecords: ExecutionCheckpoint[] = []
  const terminalByTask = new Map<string, ExecutionCheckpoint[]>()
  const cutoff = now - TERMINAL_CHECKPOINT_RETENTION_MS

  for (const record of records) {
    // `verified` is currently the only safe terminal state. Every other state
    // may be needed to prevent or recover an uncertain side effect.
    if (record.sideEffectState !== 'verified') {
      protectedRecords.push(record)
      continue
    }
    if (record.recordedAt < cutoff) continue
    const taskRecords = terminalByTask.get(record.taskId) || []
    taskRecords.push(record)
    terminalByTask.set(record.taskId, taskRecords)
  }

  const retainedTerminal = [...terminalByTask.values()].flatMap((taskRecords) =>
    taskRecords
      .sort((left, right) => left.recordedAt - right.recordedAt)
      .slice(-MAX_TERMINAL_CHECKPOINTS_PER_TASK)
  )
  return [...protectedRecords, ...retainedTerminal].sort((left, right) => left.recordedAt - right.recordedAt)
}

/**
 * Persists the small, redacted execution state independently from chat
 * messages. The same key is replaced atomically at the storage boundary.
 */
export class AgentCheckpointStore {
  private storage: AgentCheckpointStorage | null
  private readonly storageKey: string
  private readonly now: () => number
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(options: { storage?: AgentCheckpointStorage; storageKey?: string; now?: () => number } = {}) {
    this.storage = options.storage || null
    this.storageKey = options.storageKey || AGENT_CHECKPOINT_STORAGE_KEY
    this.now = options.now || Date.now
  }

  private async getStorage(): Promise<AgentCheckpointStorage> {
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

  async list(taskId?: string): Promise<ExecutionCheckpoint[]> {
    const value = await (await this.getStorage()).getStoreValue(this.storageKey)
    const records = parseEnvelope(value).records
    return taskId ? records.filter((record) => record.taskId === taskId) : records
  }

  async get(taskId: string, stepId: string, callId: string): Promise<ExecutionCheckpoint | null> {
    const key = checkpointKey({ taskId, stepId, callId })
    return (await this.list()).find((record) => checkpointKey(record) === key) || null
  }

  put(record: ExecutionCheckpoint): Promise<ExecutionCheckpoint> {
    const parsed = ExecutionCheckpointSchema.parse(record)
    return this.enqueue(async () => {
      const records = await this.list()
      const key = checkpointKey(parsed)
      const next = records.filter((candidate) => checkpointKey(candidate) !== key)
      next.push(parsed)
      next.sort((left, right) => left.recordedAt - right.recordedAt)
      await (await this.getStorage()).setStoreValue(this.storageKey, {
        schemaVersion: 1,
        records: compactCheckpoints(next, this.now()),
      } satisfies CheckpointEnvelope)
      return parsed
    })
  }

  async clearTask(taskId: string): Promise<void> {
    await this.enqueue(async () => {
      const records = (await this.list()).filter((record) => record.taskId !== taskId)
      await (await this.getStorage()).setStoreValue(this.storageKey, { schemaVersion: 1, records })
    })
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await (await this.getStorage()).setStoreValue(this.storageKey, { schemaVersion: 1, records: [] })
    })
  }
}

export function createAgentCheckpointStore(
  options: { storage?: AgentCheckpointStorage; storageKey?: string; now?: () => number } = {}
) {
  return new AgentCheckpointStore(options)
}
