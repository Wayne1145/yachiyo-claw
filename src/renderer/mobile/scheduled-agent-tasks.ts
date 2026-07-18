import { App } from '@capacitor/app'
import { useSyncExternalStore } from 'react'
import { copyAgentSessionConfig, saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { ensureAgentTaskForChat } from '@/mobile/conversation-bridge'
import { router } from '@/router'
import * as chatStore from '@/stores/chatStore'
import { queryClient } from '@/stores/queryClient'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { isTaskGenerating, submitTaskMessage } from '@/stores/taskSessionActions'
import { TASK_SESSION_QUERY_KEY, taskSessionStore, updateTaskSession } from '@/stores/taskSessionStore'

const STORAGE_KEY = 'yachiyo-scheduled-agent-tasks-v1'
const CHANGE_EVENT = 'yachiyo-scheduled-agent-tasks-change'

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

function persist(tasks: ScheduledAgentTask[]): void {
  cachedTasks = [...tasks].sort((left, right) => left.runAt - right.runAt)
  cachedRaw = JSON.stringify(cachedTasks)
  localStorage.setItem(STORAGE_KEY, cachedRaw)
  window.dispatchEvent(new Event(CHANGE_EVENT))
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
  persist([...getScheduledAgentTasks(), task])
  return task
}

export function updateScheduledAgentTask(
  id: string,
  patch: Partial<Omit<ScheduledAgentTask, 'id' | 'createdAt'>>
): ScheduledAgentTask | null {
  let updated: ScheduledAgentTask | null = null
  const tasks = getScheduledAgentTasks().map((task) => {
    if (task.id !== id) return task
    updated = { ...task, ...patch }
    return updated
  })
  if (updated) persist(tasks)
  return updated
}

export function deleteScheduledAgentTask(id: string): void {
  persist(getScheduledAgentTasks().filter((task) => task.id !== id))
}

export function calculateNextScheduledRunAt(repeat: ScheduledTaskRepeat, previousRunAt: number, now: number): number {
  if (repeat === 'once') return previousRunAt
  const interval = repeat === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  let next = previousRunAt + interval
  while (next <= now) next += interval
  return next
}

async function createAndRunAgentConversation(
  task: ScheduledAgentTask,
  navigateToConversation: boolean
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
  await submitTaskMessage(agentTask.id, task.prompt)
  return agentTask.id
}

export async function executeScheduledAgentTask(
  id: string,
  options: { navigateToConversation?: boolean; consumeSchedule?: boolean } = {}
): Promise<void> {
  const task = getScheduledAgentTasks().find((candidate) => candidate.id === id)
  if (!task) throw new Error('scheduled_task_not_found')
  if (isTaskGenerating()) throw new Error('agent_busy')

  updateScheduledAgentTask(id, { status: 'running', lastError: undefined })
  const startedAt = Date.now()
  try {
    const sessionId = await createAndRunAgentConversation(task, options.navigateToConversation ?? true)
    const consumeSchedule = options.consumeSchedule ?? false
    const repeating = task.repeat !== 'once'
    updateScheduledAgentTask(id, {
      status: consumeSchedule && !repeating ? 'completed' : 'scheduled',
      enabled: consumeSchedule && !repeating ? false : task.enabled,
      runAt:
        consumeSchedule && repeating ? calculateNextScheduledRunAt(task.repeat, task.runAt, Date.now()) : task.runAt,
      lastRunAt: startedAt,
      lastSessionId: sessionId,
      lastError: undefined,
    })
  } catch (error) {
    const consumeSchedule = options.consumeSchedule ?? false
    const repeating = task.repeat !== 'once'
    updateScheduledAgentTask(id, {
      status: 'failed',
      enabled: consumeSchedule && !repeating ? false : task.enabled,
      runAt:
        consumeSchedule && repeating ? calculateNextScheduledRunAt(task.repeat, task.runAt, Date.now()) : task.runAt,
      lastRunAt: startedAt,
      lastError: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function runDueScheduledAgentTasks(now = Date.now()): Promise<void> {
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
  const timer = window.setInterval(check, 15_000)
  let disposed = false
  let removeAppStateListener: (() => Promise<void>) | undefined

  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) check()
  }).then((handle) => {
    if (disposed) void handle.remove()
    else removeAppStateListener = () => handle.remove()
  })
  check()

  return () => {
    disposed = true
    window.clearInterval(timer)
    if (removeAppStateListener) void removeAppStateListener()
  }
}
