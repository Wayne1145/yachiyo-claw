import type { Message, Session, TaskSession } from '@shared/types'
import * as chatStore from '@/stores/chatStore'
import { initEmptyChatSession } from '@/stores/sessionHelpers'

export function mergeTaskMessagesIntoChat(chat: Pick<Session, 'messages'>, taskMessages: Message[]): Message[] {
  const systemMessages = chat.messages.filter((message) => message.role === 'system').slice(0, 1)
  return [...systemMessages, ...taskMessages.filter((message) => message.role !== 'system')]
}

export async function syncTaskSessionToChat(task: TaskSession): Promise<Session | null> {
  if (!task.linkedSessionId) return null
  const chat = await chatStore.getSession(task.linkedSessionId)
  if (!chat) return null

  return chatStore.updateSessionWithMessages(chat.id, {
    name: task.name,
    messages: mergeTaskMessagesIntoChat(chat, task.messages),
    settings: task.settings || chat.settings,
  })
}

export function createChatSessionFromTask(task: TaskSession): Promise<Session> {
  const emptyChat = initEmptyChatSession()
  return chatStore.createSession({
    ...emptyChat,
    name: task.name,
    messages: mergeTaskMessagesIntoChat(emptyChat, task.messages),
    settings: task.settings || emptyChat.settings,
  })
}
