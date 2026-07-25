import { describe, expect, it } from 'vitest'
import {
  AGENT_RUN_CHECKPOINT_STORAGE_KEY,
  AgentRunCheckpointStore,
  type AgentRunCheckpoint,
} from './agent-run-checkpoints'

class MemoryStorage {
  values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key))
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

const run: AgentRunCheckpoint = {
  schemaVersion: 1,
  runId: 'task:assistant',
  taskId: 'task',
  assistantMessageId: 'assistant',
  phase: 'requesting',
  currentStep: 0,
  completedSteps: [],
  updatedAt: 100,
}

describe('AgentRunCheckpointStore', () => {
  it('persists current step, bounded tool result, and pending approval state', async () => {
    const storage = new MemoryStorage()
    const store = new AgentRunCheckpointStore(storage)
    await store.put(run)
    await store.update(run.runId, {
      phase: 'awaiting_approval',
      pendingApproval: { title: 'write file', risk: 'dangerous', kind: 'operation' },
    })
    await store.addStepResult(run.runId, 0, { toolCallId: 'call-1', output: 'ok' })

    await expect(store.listActive()).resolves.toEqual([
      expect.objectContaining({
        phase: 'streaming',
        currentStep: 1,
        completedSteps: [expect.objectContaining({ result: { toolCallId: 'call-1', output: 'ok' } })],
      }),
    ])
    expect(storage.values.has(AGENT_RUN_CHECKPOINT_STORAGE_KEY)).toBe(true)
  })

  it('does not recover terminal runs', async () => {
    const store = new AgentRunCheckpointStore(new MemoryStorage())
    await store.put(run)
    await store.finish(run.runId, 'completed')
    await expect(store.listActive()).resolves.toEqual([])
  })

  it('serializes concurrent mutations without losing a run', async () => {
    const store = new AgentRunCheckpointStore(new MemoryStorage())
    await Promise.all([
      store.put(run),
      store.put({ ...run, runId: 'other:assistant', taskId: 'other', updatedAt: 101 }),
    ])
    await expect(store.listActive()).resolves.toHaveLength(2)
  })
})
