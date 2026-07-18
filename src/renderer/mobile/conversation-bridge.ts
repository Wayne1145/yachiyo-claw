import type { TaskSession } from '@shared/types'
import { router } from '@/router'
import * as chatStore from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/sessionActions'
import {
  createTaskSession,
  getTaskSession,
  listAllTaskSessions,
  taskSessionStore,
  updateTaskSession,
} from '@/stores/taskSessionStore'
import { getAgentWorkingDirectory } from './agent-broker'
import { copyAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'
import { createChatSessionFromTask, syncTaskSessionToChat } from './conversation-sync'

export async function findTaskForChatSession(sessionId: string): Promise<TaskSession | null> {
  const tasks = await listAllTaskSessions()
  return tasks.find((task) => task.linkedSessionId === sessionId) || null
}

export async function ensureAgentTaskForChat(sessionId: string): Promise<TaskSession> {
  const chat = await chatStore.getSession(sessionId)
  if (!chat) throw new Error('chat_session_not_found')

  const taskMessages = chat.messages.filter((message) => message.role !== 'system')
  const existing = await findTaskForChatSession(sessionId)
  if (existing) {
    const existingIds = new Set(existing.messages.map((message) => message.id))
    const mergedMessages = [
      ...existing.messages,
      ...taskMessages.filter((message) => !existingIds.has(message.id)),
    ].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
    return (
      (await updateTaskSession(existing.id, {
        name: chat.name,
        messages: mergedMessages,
        settings: chat.settings,
      })) || existing
    )
  }

  return createTaskSession({
    linkedSessionId: chat.id,
    name: chat.name,
    workingDirectory: getAgentWorkingDirectory(),
    messages: taskMessages,
    settings: chat.settings,
  })
}

export async function ensureChatSessionForTask(taskId: string): Promise<string> {
  const task = await getTaskSession(taskId)
  if (!task) throw new Error('task_session_not_found')

  if (task.linkedSessionId) {
    const linked = await chatStore.getSession(task.linkedSessionId)
    if (linked) {
      await syncTaskSessionToChat(task)
      return linked.id
    }
  }

  const chat = await createChatSessionFromTask(task)
  await updateTaskSession(task.id, { linkedSessionId: chat.id })
  return chat.id
}

export async function openChatSessionAsAgent(sessionId: string): Promise<void> {
  const task = await ensureAgentTaskForChat(sessionId)
  copyAgentSessionConfig(sessionId, task.id)
  saveAgentSessionConfig(task.id, { enabled: true, configured: true })
  taskSessionStore.getState().setCurrentTaskId(task.id)
  await router.navigate({ to: '/task/$taskId', params: { taskId: task.id } })
}

export async function openTaskSessionAsChat(taskId: string): Promise<void> {
  const sessionId = await ensureChatSessionForTask(taskId)
  copyAgentSessionConfig(taskId, sessionId)
  saveAgentSessionConfig(sessionId, { enabled: false, allowDangerousForConversation: false })
  switchCurrentSession(sessionId)
}
