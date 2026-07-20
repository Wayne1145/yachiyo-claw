import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { ScheduleOutboxEvent, ScheduleRecord, ScheduleStatus } from '@shared/scheduler/contracts'
import { useSyncExternalStore } from 'react'
import { copyAgentSessionConfig, saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { ensureAgentTaskForChat } from '@/mobile/conversation-bridge'
import { router } from '@/router'
import * as chatStore from '@/stores/chatStore'
import { queryClient } from '@/stores/queryClient'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { isTaskGenerating, submitTaskMessage } from '@/stores/taskSessionActions'
import { TASK_SESSION_QUERY_KEY, taskSessionStore, updateTaskSession } from '@/stores/taskSessionStore'
import {
  acknowledgeNativeSchedule,
  beginNativeScheduleForeground,
  deleteNativeSchedule,
  drainNativeScheduleOutbox,
  listNativeSchedules,
  migrateLegacyNativeSchedules,
  reconcileNativeSchedules,
  subscribeNativeScheduleOutbox,
  subscribeNativeScheduleStatus,
  upsertNativeSchedule,
} from '@/platform/native/yachiyo_scheduler'

const STORAGE_KEY = 'yachiyo-scheduled-agent-tasks-v1'
const CHANGE_EVENT = 'yachiyo-scheduled-agent-tasks-change'
const NATIVE_MIGRATION_KEY = 'yachiyo-scheduled-agent-tasks-native-migrated-v1'

export type ScheduledTaskRepeat = 'once' | 'daily' | 'weekly'
export type ScheduledTaskStatus = 'scheduled' | 'running' | 'completed' | 'failed'

export interface ScheduledAgentTask {
  id: string
  title: string
  prompt: string
  runAt: number
  repeat: ScheduledTaskRepeat
  enabled: boolean
  status: ScheduledTaskStatus
  createdAt: number
  lastRunAt?: number
  lastError?: string
  lastSessionId?: string
  nativeStatus?: ScheduleStatus
  currentExecutionId?: string
  needsForeground?: boolean
}

export interface CreateScheduledAgentTaskInput {
  title: string
  prompt: string
  runAt: number
  repeat: ScheduledTaskRepeat
}

export function recoverInterruptedScheduledTasks(tasks: ScheduledAgentTask[]): ScheduledAgentTask[] {
  return tasks.map((task) =>
    task.status === 'running'
      ? { ...task, status: 'failed', lastError: '上次运行被系统或应用终止，可以重新执行。' }
      : task
  )
}

let cachedRaw = ''
let cachedTasks: ScheduledAgentTask[] = []
let draining = false
let nativeInitialization: Promise<void> | null = null

function usesNativeScheduler(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function isScheduledAgentTask(value: unknown): value is ScheduledAgentTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<ScheduledAgentTask>
  return (
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.prompt === 'string' &&
    typeof task.runAt === 'number' &&
    (task.repeat === 'once' || task.repeat === 'daily' || task.repeat === 'weekly') &&
    typeof task.enabled === 'boolean'
  )
}

export function getScheduledAgentTasks(): ScheduledAgentTask[] {
  if (usesNativeScheduler()) {
    if (!nativeInitialization) void initializeNativeScheduler().catch(() => undefined)
    return cachedTasks
  }
  if (typeof localStorage === 'undefined') return cachedTasks
  const raw = localStorage.getItem(STORAGE_KEY) || '[]'
  if (raw === cachedRaw) return cachedTasks

  cachedRaw = raw
  try {
    const parsed = JSON.parse(raw) as unknown
    cachedTasks = Array.isArray(parsed)
      ? recoverInterruptedScheduledTasks(parsed.filter(isScheduledAgentTask)).sort((left, right) => left.runAt - right.runAt)
      : []
    const normalizedRaw = JSON.stringify(cachedTasks)
    if (normalizedRaw !== raw) {
      cachedRaw = normalizedRaw
      localStorage.setItem(STORAGE_KEY, normalizedRaw)
    }
  } catch {
    cachedTasks = []
  }
  return cachedTasks
}

function publish(tasks: ScheduledAgentTask[]): void {
  cachedTasks = [...tasks].sort((left, right) => left.runAt - right.runAt)
  cachedRaw = JSON.stringify(cachedTasks)
  if (!usesNativeScheduler()) localStorage.setItem(STORAGE_KEY, cachedRaw)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function statusFromNative(status: ScheduleStatus): ScheduledTaskStatus {
  if (status === 'running') return 'running'
  if (status === 'succeeded') return 'completed'
  if (status === 'retryable-failed' || status === 'permanent-failed') return 'failed'
  return 'scheduled'
}

function projectNativeSchedule(record: ScheduleRecord): ScheduledAgentTask {
  const previous = cachedTasks.find((task) => task.id === record.id)
  const interrupted = record.status === 'running' && !isTaskGenerating()
  return {
    id: record.id,
    title: record.title,
    prompt: record.prompt,
    runAt: record.nextRunAt,
    repeat: record.repeat,
    enabled: record.enabled,
    status: statusFromNative(record.status),
    createdAt: record.createdAt,
    lastRunAt: previous?.lastRunAt,
    lastSessionId: previous?.lastSessionId,
    lastError:
      previous?.lastError ||
      (interrupted ? '上次前台执行未完成，已停止自动重放；请检查对应会话后手动继续。' : undefined),
    nativeStatus: record.status,
    currentExecutionId: record.currentExecutionId,
    needsForeground:
      record.status === 'awaiting-foreground' || record.status === 'awaiting-approval' || record.status === 'paused',
  }
}

async function refreshNativeSchedules(): Promise<void> {
  const result = await listNativeSchedules()
  publish(result.schedules.map(projectNativeSchedule))
}

export function subscribeScheduledAgentTasks(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedRaw = ''
      listener()
    }
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useScheduledAgentTasks(): ScheduledAgentTask[] {
  return useSyncExternalStore(subscribeScheduledAgentTasks, getScheduledAgentTasks, getScheduledAgentTasks)
}

function nativeScheduleInput(task: ScheduledAgentTask) {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    runAt: task.runAt,
    repeat: task.repeat,
    enabled: task.enabled,
    exact: false,
    requiresNetwork: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }
}

function recordNativeMutationFailure(id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'native_scheduler_failed'
  publish(
    cachedTasks.map((task) =>
      task.id === id ? { ...task, status: 'failed', lastError: message.slice(0, 1_024) } : task
    )
  )
}

export function createScheduledAgentTask(input: CreateScheduledAgentTaskInput): ScheduledAgentTask {
  const title = input.title.trim()
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('task_prompt_required')
  if (!Number.isFinite(input.runAt)) throw new Error('task_run_time_invalid')

  const task: ScheduledAgentTask = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title || prompt.slice(0, 24),
    prompt,
    runAt: input.runAt,
    repeat: input.repeat,
    enabled: true,
    status: 'scheduled',
    createdAt: Date.now(),
  }
  publish([...getScheduledAgentTasks(), task])
  if (usesNativeScheduler()) {
    void upsertNativeSchedule(nativeScheduleInput(task))
      .then(() => refreshNativeSchedules())
      .catch((error) => recordNativeMutationFailure(task.id, error))
  }
  return task
}

export function updateScheduledAgentTask(
  id: string,
  patch: Partial<Omit<ScheduledAgentTask, 'id' | 'createdAt'>>,
  options: { persistNative?: boolean } = {}
): ScheduledAgentTask | null {
  let updated: ScheduledAgentTask | null = null
  const tasks = getScheduledAgentTasks().map((task) => {
    if (task.id !== id) return task
    updated = { ...task, ...patch }
    return updated
  })
  if (updated) {
    publish(tasks)
    const changesSchedule =
      options.persistNative ?? ['title', 'prompt', 'runAt', 'repeat', 'enabled'].some((key) => key in patch)
    if (usesNativeScheduler() && changesSchedule) {
      void upsertNativeSchedule(nativeScheduleInput(updated))
        .then(() => refreshNativeSchedules())
        .catch((error) => recordNativeMutationFailure(id, error))
    }
  }
  return updated
}

export function deleteScheduledAgentTask(id: string): void {
  const previous = getScheduledAgentTasks()
  publish(previous.filter((task) => task.id !== id))
  if (usesNativeScheduler()) {
    void deleteNativeSchedule(id).catch(() => publish(previous))
  }
}

export function calculateNextScheduledRunAt(repeat: ScheduledTaskRepeat, previousRunAt: number, now: number): number {
  if (repeat === 'once') return previousRunAt
  const interval = repeat === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  let next = previousRunAt + interval
  while (next <= now) next += interval
  return next
}

function readLegacyTasksForMigration(): ScheduledAgentTask[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? recoverInterruptedScheduledTasks(parsed.filter(isScheduledAgentTask)) : []
  } catch {
    return []
  }
}

function executionCheckpoint(
  event: ScheduleOutboxEvent,
  stepId: string,
  state: 'running' | 'succeeded' | 'unknown'
): string {
  return JSON.stringify({
    version: 1,
    scheduleId: event.scheduleId,
    executionId: event.executionId,
    stepId,
    callId: event.executionId,
    state,
    updatedAt: Date.now(),
  })
}

async function handleNativeScheduleEvent(event: ScheduleOutboxEvent): Promise<void> {
  const existing = cachedTasks.find((task) => task.id === event.scheduleId)
  const task: ScheduledAgentTask =
    existing || {
      id: event.scheduleId,
      title: event.title,
      prompt: event.prompt,
      runAt: event.runAt,
      repeat: event.repeat,
      enabled: event.enabled,
      status: 'scheduled',
      createdAt: Date.now(),
      nativeStatus: event.status,
      currentExecutionId: event.executionId,
    }

  if (event.eventType === 'schedule_failed') {
    await acknowledgeNativeSchedule({
      deliveryId: event.deliveryId,
      deliveryToken: event.deliveryToken,
      scheduleId: event.scheduleId,
      executionId: event.executionId,
      status: 'permanent-failed',
      error: 'native_scheduler_permanent_failure',
      checkpoint: '{}',
      result: '{}',
    })
    publish(
      cachedTasks.map((item) =>
        item.id === task.id ? { ...item, status: 'failed', lastError: '后台调度永久失败' } : item
      )
    )
    return
  }

  if (isTaskGenerating()) throw new Error('agent_busy')
  const runningTask: ScheduledAgentTask = {
    ...task,
    status: 'running',
    nativeStatus: 'awaiting-foreground',
    currentExecutionId: event.executionId,
    lastError: undefined,
  }
  publish(
    cachedTasks.some((item) => item.id === task.id)
      ? cachedTasks.map((item) => (item.id === task.id ? runningTask : item))
      : [...cachedTasks, runningTask]
  )

  const startedAt = Date.now()
  let sessionId: string | undefined
  let handoffStarted = false
  try {
    // Persist the conversation before committing the delivery handoff. The native
    // checkpoint then prevents an uncertain device action from being replayed.
    sessionId = await createAndRunAgentConversation(task, false, false)
    await beginNativeScheduleForeground({
      deliveryId: event.deliveryId,
      deliveryToken: event.deliveryToken,
      scheduleId: event.scheduleId,
      executionId: event.executionId,
      checkpoint: executionCheckpoint(event, sessionId, 'running'),
    })
    handoffStarted = true
    await submitTaskMessage(sessionId, event.prompt)
    const session = queryClient.getQueryData<any>([TASK_SESSION_QUERY_KEY, sessionId])
    const lastMessage = session?.messages?.[session.messages.length - 1]
    if (lastMessage?.error) throw new Error(String(lastMessage.error).slice(0, 1_024))
    await acknowledgeNativeSchedule({
      scheduleId: event.scheduleId,
      executionId: event.executionId,
      status: 'succeeded',
      checkpoint: executionCheckpoint(event, sessionId, 'succeeded'),
      result: JSON.stringify({ sessionId }),
    })
    publish(
      cachedTasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: task.repeat === 'once' ? 'completed' : 'scheduled',
              enabled: task.repeat === 'once' ? false : item.enabled,
              lastRunAt: startedAt,
              lastSessionId: sessionId,
              lastError: undefined,
              nativeStatus: 'succeeded',
              needsForeground: false,
            }
          : item
      )
    )
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message.slice(0, 1_024) : 'scheduled_agent_failed'
    if (!handoffStarted) {
      // The durable outbox lease remains available when the foreground handoff was not committed.
      throw error
    }
    try {
      // Side effects may already have happened. Pause for inspection instead of replaying them.
      await acknowledgeNativeSchedule({
        scheduleId: event.scheduleId,
        executionId: event.executionId,
        status: 'paused',
        error: safeMessage,
        checkpoint: executionCheckpoint(event, sessionId || 'unknown', 'unknown'),
        result: '{}',
      })
    } finally {
      publish(
        cachedTasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: 'failed',
                nativeStatus: 'paused',
                needsForeground: true,
                lastRunAt: startedAt,
                lastSessionId: sessionId,
                lastError: safeMessage,
              }
            : item
        )
      )
    }
  }
  await refreshNativeSchedules()
}

async function drainNativeScheduleEvents(): Promise<void> {
  if (!usesNativeScheduler() || draining || isTaskGenerating()) return
  draining = true
  try {
    const result = await drainNativeScheduleOutbox(20)
    for (const event of result.events) {
      try {
        await handleNativeScheduleEvent(event)
      } catch (error) {
        if (error instanceof Error && error.message === 'agent_busy') break
        // An uncommitted delivery remains in the native outbox for a later foreground retry.
      }
    }
  } finally {
    draining = false
  }
}

async function initializeNativeScheduler(): Promise<void> {
  if (!usesNativeScheduler()) return
  if (nativeInitialization) return nativeInitialization
  nativeInitialization = (async () => {
    const migrationDone = localStorage.getItem(NATIVE_MIGRATION_KEY) === '1'
    if (!migrationDone) {
      const legacy = readLegacyTasksForMigration()
      const result = await migrateLegacyNativeSchedules(legacy.map(nativeScheduleInput))
      if (result.errors.length === 0) {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.setItem(NATIVE_MIGRATION_KEY, '1')
      }
    }
    await reconcileNativeSchedules()
    await refreshNativeSchedules()
    await drainNativeScheduleEvents()
  })().catch((error) => {
    // Do not fall back to localStorage as a second Android source of truth.
    publish(
      cachedTasks.map((task) => ({ ...task, status: 'failed', lastError: 'native_scheduler_unavailable' }))
    )
    throw error
  })
  return nativeInitialization
}

async function createAndRunAgentConversation(
  task: ScheduledAgentTask,
  navigateToConversation: boolean,
  submit = true
): Promise<string> {
  const chat = await chatStore.createSession(initEmptyChatSession())
  copyAgentSessionConfig('new', chat.id)
  let agentTask = await ensureAgentTaskForChat(chat.id)
  agentTask =
    (await updateTaskSession(agentTask.id, {
      name: task.title,
    })) || agentTask
  queryClient.setQueryData([TASK_SESSION_QUERY_KEY, agentTask.id], agentTask)
  copyAgentSessionConfig(chat.id, agentTask.id)
  saveAgentSessionConfig(agentTask.id, {
    enabled: true,
    configured: true,
    approvalMode: 'manual',
  })
  taskSessionStore.getState().setCurrentTaskId(agentTask.id)

  if (navigateToConversation) {
    await router.navigate({ to: '/task/$taskId', params: { taskId: agentTask.id } })
  }
  if (submit) await submitTaskMessage(agentTask.id, task.prompt)
  return agentTask.id
}

export async function executeScheduledAgentTask(
  id: string,
  options: { navigateToConversation?: boolean; consumeSchedule?: boolean } = {}
): Promise<void> {
  const task = getScheduledAgentTasks().find((candidate) => candidate.id === id)
  if (!task) throw new Error('scheduled_task_not_found')
  if (isTaskGenerating()) throw new Error('agent_busy')

  updateScheduledAgentTask(id, { status: 'running', lastError: undefined }, { persistNative: false })
  const startedAt = Date.now()
  try {
    const sessionId = await createAndRunAgentConversation(task, options.navigateToConversation ?? true)
    const consumeSchedule = options.consumeSchedule ?? false
    const repeating = task.repeat !== 'once'
    updateScheduledAgentTask(
      id,
      {
        status: consumeSchedule && !repeating ? 'completed' : 'scheduled',
        enabled: consumeSchedule && !repeating ? false : task.enabled,
        runAt:
          consumeSchedule && repeating
            ? calculateNextScheduledRunAt(task.repeat, task.runAt, Date.now())
            : task.runAt,
        lastRunAt: startedAt,
        lastSessionId: sessionId,
        lastError: undefined,
      },
      { persistNative: false }
    )
  } catch (error) {
    const consumeSchedule = options.consumeSchedule ?? false
    const repeating = task.repeat !== 'once'
    updateScheduledAgentTask(
      id,
      {
        status: 'failed',
        enabled: consumeSchedule && !repeating ? false : task.enabled,
        runAt:
          consumeSchedule && repeating
            ? calculateNextScheduledRunAt(task.repeat, task.runAt, Date.now())
            : task.runAt,
        lastRunAt: startedAt,
        lastError: error instanceof Error ? error.message : String(error),
      },
      { persistNative: false }
    )
    throw error
  }
}

export async function runDueScheduledAgentTasks(now = Date.now()): Promise<void> {
  if (usesNativeScheduler()) {
    await drainNativeScheduleEvents()
    return
  }
  if (draining || isTaskGenerating()) return
  draining = true
  try {
    const dueTasks = getScheduledAgentTasks().filter(
      (task) => task.enabled && task.status !== 'running' && task.runAt <= now
    )
    for (const task of dueTasks) {
      try {
        await executeScheduledAgentTask(task.id, { navigateToConversation: false, consumeSchedule: true })
      } catch {
        // Failure details are persisted on the individual task.
      }
    }
  } finally {
    draining = false
  }
}

export function installScheduledAgentTaskRunner(): () => void {
  const check = () => void runDueScheduledAgentTasks()
  const native = usesNativeScheduler()
  const timer = native ? undefined : window.setInterval(check, 15_000)
  let disposed = false
  let removeAppStateListener: (() => Promise<void>) | undefined
  let removeNativeStatusListener: (() => Promise<void>) | undefined
  let removeNativeOutboxListener: (() => Promise<void>) | undefined

  if (native) {
    void initializeNativeScheduler().catch(() => undefined)
    void subscribeNativeScheduleStatus((record) => {
      const projected = projectNativeSchedule(record)
      publish([...cachedTasks.filter((task) => task.id !== projected.id), projected])
    }).then((handle) => {
      if (disposed) void handle.remove()
      else removeNativeStatusListener = () => handle.remove()
    })
    void subscribeNativeScheduleOutbox(() => void drainNativeScheduleEvents()).then((handle) => {
      if (disposed) void handle.remove()
      else removeNativeOutboxListener = () => handle.remove()
    })
  }

  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) check()
  }).then((handle) => {
    if (disposed) void handle.remove()
    else removeAppStateListener = () => handle.remove()
  })
  check()

  return () => {
    disposed = true
    if (timer !== undefined) window.clearInterval(timer)
    if (removeAppStateListener) void removeAppStateListener()
    if (removeNativeStatusListener) void removeNativeStatusListener()
    if (removeNativeOutboxListener) void removeNativeOutboxListener()
  }
}
