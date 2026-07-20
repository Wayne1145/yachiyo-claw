import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeNativeSchedule,
  drainNativeScheduleOutbox,
  getNativeSchedulerCapabilities,
  listNativeSchedules,
  runNativeSchedule,
  upsertNativeSchedule,
} from './yachiyo_scheduler'

const nativePluginMock = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  addListener: vi.fn(),
  drain: vi.fn(),
  list: vi.fn(),
  run: vi.fn(),
  upsert: vi.fn(),
  capabilities: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => nativePluginMock),
}))

describe('YachiyoScheduler bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps WorkManager-facing calls identifier-only for run and drains durable events', async () => {
    nativePluginMock.run.mockResolvedValue({ id: 'schedule-1' })
    nativePluginMock.drain.mockResolvedValue({ schemaVersion: 1, events: [] })
    await runNativeSchedule('schedule-1')
    await drainNativeScheduleOutbox(3)
    expect(nativePluginMock.run).toHaveBeenCalledWith({ id: 'schedule-1' })
    expect(nativePluginMock.drain).toHaveBeenCalledWith({ limit: 3 })
  })

  it('exposes list/upsert/acknowledge without rewriting payloads in the bridge', async () => {
    const spec = { title: 'Wake', prompt: 'check', runAt: 123, repeat: 'once' as const }
    nativePluginMock.list.mockResolvedValue({ schedules: [] })
    nativePluginMock.upsert.mockResolvedValue({ id: 'schedule-1' })
    nativePluginMock.acknowledge.mockResolvedValue({
      acknowledged: true,
      status: 'succeeded',
      headlessExecution: false,
    })
    await listNativeSchedules()
    await upsertNativeSchedule(spec)
    await acknowledgeNativeSchedule({ scheduleId: 'schedule-1', executionId: 'execution-1', status: 'succeeded' })
    expect(nativePluginMock.upsert).toHaveBeenCalledWith(spec)
    expect(nativePluginMock.acknowledge).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      executionId: 'execution-1',
      status: 'succeeded',
    })
  })

  it('reports foreground-required execution without claiming a native headless Agent runtime', async () => {
    nativePluginMock.capabilities.mockResolvedValue({
      schemaVersion: 1,
      workManager: true,
      roomStore: true,
      executionMode: 'foreground-required',
      wakeMode: 'workmanager-foreground-service',
      headlessExecution: false,
      backgroundAgentRuntime: false,
      foregroundDrain: true,
      durableForegroundHandoff: true,
      bootRecovery: true,
      lockedBootDeferredUntilUnlock: true,
      packageReplaceRecovery: true,
      clockChangeRecovery: true,
      forceStopRecovery: false,
      approvalReplay: false,
      sideEffectReplay: false,
      pendingState: 'awaiting-foreground',
    })
    await expect(getNativeSchedulerCapabilities()).resolves.toMatchObject({
      executionMode: 'foreground-required',
      headlessExecution: false,
      sideEffectReplay: false,
    })
  })
})
