import { describe, expect, it, vi } from 'vitest'
import { AgentActionRecoveryRequiredError, digestAgentJson, executeAgentAction } from './agent-broker'
import { type AgentCheckpointStorage, AgentCheckpointStore } from './agent-checkpoints'

class MemoryStorage implements AgentCheckpointStorage {
  private values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }
}

class InterleavingStorage extends MemoryStorage {
  override async getStoreValue(key: string): Promise<unknown> {
    await Promise.resolve()
    return super.getStoreValue(key)
  }

  override async setStoreValue(key: string, value: unknown): Promise<void> {
    await Promise.resolve()
    return super.setStoreValue(key, value)
  }
}

const base = {
  schemaVersion: 1 as const,
  taskId: 'task-1',
  stepId: 'step-1',
  callId: 'call-1',
  attempt: 1,
  toolId: 'device.ui.tap',
  parameterDigest: 'a'.repeat(64),
  expectedState: { following: true },
  sideEffectState: 'unknown' as const,
  resultDigest: null,
  recordedAt: 1_000_000,
}

describe('AgentCheckpointStore', () => {
  it('replaces a call checkpoint and retrieves it by task/step/call', async () => {
    const store = new AgentCheckpointStore({ storage: new MemoryStorage(), now: () => 1_000_000 })
    await store.put(base)
    await store.put({ ...base, sideEffectState: 'verified', recordedAt: 1_000_001 })

    await expect(store.get('task-1', 'step-1', 'call-1')).resolves.toMatchObject({
      sideEffectState: 'verified',
      recordedAt: 1_000_001,
    })
    await expect(store.list('task-2')).resolves.toEqual([])
  })

  it('drops malformed persisted records and clears a task without touching others', async () => {
    const storage = new MemoryStorage()
    const store = new AgentCheckpointStore({ storage })
    await store.put(base)
    await store.put({ ...base, taskId: 'task-2', callId: 'call-2' })
    await storage.setStoreValue('ignored', {
      schemaVersion: 1,
      records: [{ ...base }, { taskId: 'bad' }],
    })

    await store.clearTask('task-1')
    await expect(store.list()).resolves.toHaveLength(1)
    await store.clear()
    await expect(store.list()).resolves.toEqual([])
  })

  it('serializes concurrent checkpoint mutations so parallel tool calls are not lost', async () => {
    const store = new AgentCheckpointStore({ storage: new InterleavingStorage() })

    await Promise.all([
      store.put({ ...base, stepId: 'step-a', callId: 'call-a' }),
      store.put({ ...base, stepId: 'step-b', callId: 'call-b', parameterDigest: 'b'.repeat(64) }),
    ])

    await expect(store.list('task-1')).resolves.toHaveLength(2)
  })

  it('keeps an old unknown checkpoint blocking replay after more than 256 verified calls', async () => {
    const store = new AgentCheckpointStore({ storage: new MemoryStorage(), now: () => 1_000_000 })
    const parameters = { selector: 'follow' }
    const uncertain = {
      ...base,
      taskId: 'uncertain-task',
      parameterDigest: await digestAgentJson(parameters),
      sideEffectState: 'unknown' as const,
    }
    await store.put(uncertain)

    for (let index = 0; index < 300; index += 1) {
      await store.put({
        ...base,
        taskId: 'busy-task',
        stepId: `step-${index}`,
        callId: `call-${index}`,
        sideEffectState: 'verified',
        recordedAt: 1_000_001 + index,
      })
    }

    await expect(store.get(uncertain.taskId, uncertain.stepId, uncertain.callId)).resolves.toMatchObject({
      sideEffectState: 'unknown',
    })
    await expect(store.list('busy-task')).resolves.toHaveLength(256)

    const execute = vi.fn().mockResolvedValue({ success: true })
    await expect(
      executeAgentAction({
        toolId: uncertain.toolId,
        backend: 'accessibility',
        parameters,
        taskId: uncertain.taskId,
        stepId: uncertain.stepId,
        callId: uncertain.callId,
        deadline: Date.now() + 30_000,
        checkpointStore: store,
        execute,
      })
    ).rejects.toBeInstanceOf(AgentActionRecoveryRequiredError)
    expect(execute).not.toHaveBeenCalled()
  })

  it('clearTask removes protected checkpoints without touching another task', async () => {
    const store = new AgentCheckpointStore({ storage: new MemoryStorage(), now: () => 1_000_000 })
    await store.put({ ...base, taskId: 'remove-me', sideEffectState: 'running' })
    await store.put({ ...base, taskId: 'remove-me', callId: 'applied-call', sideEffectState: 'applied' })
    await store.put({ ...base, taskId: 'keep-me', callId: 'unknown-call', sideEffectState: 'unknown' })

    await store.clearTask('remove-me')

    await expect(store.list('remove-me')).resolves.toEqual([])
    await expect(store.list('keep-me')).resolves.toHaveLength(1)
  })
})
