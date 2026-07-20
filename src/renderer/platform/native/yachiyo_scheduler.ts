import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import type {
  ScheduleBeginForegroundInput,
  ScheduleOutboxEvent,
  ScheduleRecord,
  SchedulerAcknowledgeInput,
  SchedulerCapabilities,
  SchedulerListResult,
  ScheduleSpec,
} from '@shared/scheduler/contracts'

interface ScheduleUpsertResult extends ScheduleRecord {
  execution: {
    id: string
    scheduleId: string
    status: ScheduleRecord['status']
    attempt: number
    scheduledAt: number
    claimedAt: number
    leaseExpiresAt: number
    startedAt: number
    finishedAt: number
    lastError: string
    checkpoint: string
  }
}

interface ScheduleDrainResult {
  schemaVersion: 1
  events: ScheduleOutboxEvent[]
}

interface ScheduleAcknowledgeResult {
  acknowledged: true
  status: ScheduleRecord['status']
  headlessExecution: false
  next?: ScheduleUpsertResult
}

interface YachiyoSchedulerPlugin {
  list(): Promise<SchedulerListResult>
  upsert(options: ScheduleSpec): Promise<ScheduleUpsertResult>
  run(options: { id: string }): Promise<ScheduleUpsertResult>
  delete(options: { id: string }): Promise<{ id: string; deleted: boolean }>
  cancel(options: { id: string }): Promise<{ id: string; deleted: boolean }>
  reconcile(): Promise<{
    schemaVersion: 1
    recoveredLeases: number
    enqueued: number
    headlessExecution: false
    pendingState: 'awaiting-foreground'
  }>
  drain(options?: { limit?: number }): Promise<ScheduleDrainResult>
  beginForeground(options: ScheduleBeginForegroundInput): Promise<{
    started: boolean
    scheduleId: string
    executionId: string
    status: 'running'
  }>
  acknowledge(options: SchedulerAcknowledgeInput): Promise<ScheduleAcknowledgeResult>
  migrateLegacy(options: { tasks: ScheduleSpec[] }): Promise<{ schemaVersion: 1; imported: number; errors: number[] }>
  capabilities(): Promise<SchedulerCapabilities>
  addListener(
    eventName: 'scheduleStatusChanged',
    listener: (event: ScheduleUpsertResult) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'outboxAvailable',
    listener: (event: { schemaVersion: 1; count: number }) => void
  ): Promise<PluginListenerHandle>
}

export type YachiyoSchedulerUpsertResult = ScheduleUpsertResult

export const yachiyoSchedulerNative = registerPlugin<YachiyoSchedulerPlugin>('YachiyoScheduler')

export function listNativeSchedules(): Promise<SchedulerListResult> {
  return yachiyoSchedulerNative.list()
}

export function upsertNativeSchedule(input: ScheduleSpec): Promise<ScheduleUpsertResult> {
  return yachiyoSchedulerNative.upsert(input)
}

export function runNativeSchedule(id: string): Promise<ScheduleUpsertResult> {
  return yachiyoSchedulerNative.run({ id })
}

export function deleteNativeSchedule(id: string): Promise<{ id: string; deleted: boolean }> {
  return yachiyoSchedulerNative.delete({ id })
}

export function drainNativeScheduleOutbox(limit = 20): Promise<ScheduleDrainResult> {
  return yachiyoSchedulerNative.drain({ limit })
}

export function reconcileNativeSchedules() {
  return yachiyoSchedulerNative.reconcile()
}

export function migrateLegacyNativeSchedules(tasks: ScheduleSpec[]) {
  return yachiyoSchedulerNative.migrateLegacy({ tasks })
}

export function getNativeSchedulerCapabilities(): Promise<SchedulerCapabilities> {
  return yachiyoSchedulerNative.capabilities()
}

export function acknowledgeNativeSchedule(input: SchedulerAcknowledgeInput): Promise<ScheduleAcknowledgeResult> {
  return yachiyoSchedulerNative.acknowledge(input)
}

export function beginNativeScheduleForeground(input: ScheduleBeginForegroundInput) {
  return yachiyoSchedulerNative.beginForeground(input)
}

export function subscribeNativeScheduleStatus(
  listener: (event: ScheduleUpsertResult) => void
): Promise<PluginListenerHandle> {
  return yachiyoSchedulerNative.addListener('scheduleStatusChanged', listener)
}

export function subscribeNativeScheduleOutbox(
  listener: (event: { schemaVersion: 1; count: number }) => void
): Promise<PluginListenerHandle> {
  return yachiyoSchedulerNative.addListener('outboxAvailable', listener)
}
