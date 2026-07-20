import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentActionAlreadyAppliedError,
  AgentActionRecoveryRequiredError,
  ANDROID_AGENT_WORKING_DIRECTORY,
  clearCachedRootCapability,
  executeAgentAction,
  executeRootShell,
  getAgentWorkingDirectory,
  getCachedRootCapability,
  isAgentFullAccessEnabled,
  setAgentFullAccessEnabled,
  setAgentWorkingDirectory,
  verifyAgentAction,
} from './agent-broker'
import { type AgentCheckpointStorage, AgentCheckpointStore } from './agent-checkpoints'

class MemoryCheckpointStorage implements AgentCheckpointStorage {
  private values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

describe('Android Agent Tool Broker', () => {
  beforeAll(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  beforeEach(() => {
    localStorage.clear()
    clearCachedRootCapability()
  })

  it('keeps a successful Root capability across app reload state', () => {
    localStorage.setItem('yachiyo-agent-root-capability-v1', JSON.stringify({ available: true, detail: 'KernelSU' }))
    expect(getCachedRootCapability()).toEqual({ available: true, detail: 'KernelSU' })
  })

  it('persists the explicit full access setting', () => {
    expect(isAgentFullAccessEnabled()).toBe(false)
    setAgentFullAccessEnabled(true)
    expect(isAgentFullAccessEnabled()).toBe(true)
  })

  it('denies root commands while full access is disabled', async () => {
    const result = await executeRootShell('id')
    expect(result.exitCode).toBe(126)
    expect(result.stderr).toContain('未启用')
  })

  it('persists a selected working directory and keeps the default as fallback', () => {
    expect(getAgentWorkingDirectory()).toBe(ANDROID_AGENT_WORKING_DIRECTORY)
    setAgentWorkingDirectory('/storage/emulated/0/Yachiyo Claw/')
    expect(getAgentWorkingDirectory()).toBe('/storage/emulated/0/Yachiyo Claw')
  })

  it('rejects non-absolute working directories', () => {
    expect(() => setAgentWorkingDirectory('relative/path')).toThrow('invalid_working_directory')
  })

  it('does not replay a side effect after its checkpoint is applied', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    const execute = vi.fn().mockResolvedValue({ success: true })
    const request = {
      toolId: 'device.ui.tap',
      backend: 'accessibility' as const,
      parameters: { selector: 'follow' },
      taskId: 'task-1',
      stepId: 'step-1',
      callId: 'call-1',
      deadline: Date.now() + 30_000,
      sideEffect: true,
      isSuccess: (result: { success: boolean }) => result.success,
      checkpointStore,
      execute,
    }

    await expect(executeAgentAction(request)).resolves.toEqual({ success: true })
    await expect(executeAgentAction(request)).rejects.toBeInstanceOf(AgentActionAlreadyAppliedError)
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(checkpointStore.get('task-1', 'step-1', 'call-1')).resolves.toMatchObject({
      sideEffectState: 'applied',
    })
  })

  it('allows a read-only observation to be refreshed with the same call id', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    const execute = vi.fn().mockResolvedValue({ screenSignature: 'screen-1' })
    const request = {
      toolId: 'device.screen.observe',
      backend: 'accessibility' as const,
      parameters: { semantic: true },
      taskId: 'task-read',
      stepId: 'step-1',
      callId: 'call-read',
      deadline: Date.now() + 30_000,
      sideEffect: false,
      checkpointStore,
      execute,
    }
    await executeAgentAction(request)
    await executeAgentAction(request)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('deduplicates selected side effects by parameter digest across new tool call ids', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    const execute = vi.fn().mockResolvedValue({ success: true })
    const request = {
      toolId: 'device.app.launch',
      backend: 'accessibility' as const,
      parameters: { packageName: 'com.example.app' },
      taskId: 'task-digest',
      stepId: 'step-1',
      callId: 'call-1',
      deadline: Date.now() + 30_000,
      sideEffect: true,
      dedupeByParameters: true,
      checkpointStore,
      execute,
    }

    await executeAgentAction(request)
    await expect(executeAgentAction({ ...request, stepId: 'step-2', callId: 'call-2' })).rejects.toMatchObject({
      callId: 'call-1',
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent parameter-bound calls before checking the applied checkpoint', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = vi.fn(async () => {
      await gate
      return { success: true }
    })
    const base = {
      toolId: 'device.app.launch',
      backend: 'accessibility' as const,
      parameters: { packageName: 'com.example.concurrent' },
      taskId: 'task-concurrent',
      deadline: Date.now() + 30_000,
      sideEffect: true,
      dedupeByParameters: true,
      checkpointStore,
      execute,
    }

    const first = executeAgentAction({ ...base, stepId: 'step-1', callId: 'call-1' })
    const second = executeAgentAction({ ...base, stepId: 'step-2', callId: 'call-2' })
    await Promise.resolve()
    release()

    await expect(first).resolves.toEqual({ success: true })
    await expect(second).rejects.toMatchObject({ callId: 'call-1' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicitly rejected backend action retryable as not_started', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    const execute = vi.fn().mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
    const request = {
      toolId: 'device.ui.tap',
      backend: 'accessibility' as const,
      parameters: { selector: 'follow' },
      taskId: 'task-retry',
      stepId: 'step-1',
      callId: 'call-retry',
      deadline: Date.now() + 30_000,
      sideEffect: true,
      isSuccess: (result: { success: boolean }) => result.success,
      checkpointStore,
      execute,
    }

    await expect(executeAgentAction(request)).resolves.toEqual({ success: false })
    await expect(checkpointStore.get('task-retry', 'step-1', 'call-retry')).resolves.toMatchObject({
      sideEffectState: 'not_started',
    })
    await expect(executeAgentAction(request)).resolves.toEqual({ success: true })
  })

  it('requires verification after an unknown result instead of dispatching again', async () => {
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })
    const execute = vi.fn().mockRejectedValue(new Error('transport_lost'))
    const request = {
      toolId: 'device.app.launch',
      backend: 'accessibility' as const,
      parameters: { packageName: 'com.example.app' },
      taskId: 'task-2',
      stepId: 'step-1',
      callId: 'call-2',
      deadline: Date.now() + 30_000,
      sideEffect: true,
      checkpointStore,
      execute,
    }

    await expect(executeAgentAction(request)).rejects.toThrow('transport_lost')
    await expect(executeAgentAction(request)).rejects.toBeInstanceOf(AgentActionRecoveryRequiredError)
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      verifyAgentAction({
        taskId: 'task-2',
        stepId: 'step-1',
        callId: 'call-2',
        checkpointStore,
        verify: () => true,
      })
    ).resolves.toBe(true)
    await expect(checkpointStore.get('task-2', 'step-1', 'call-2')).resolves.toMatchObject({
      sideEffectState: 'verified',
    })
  })
})
