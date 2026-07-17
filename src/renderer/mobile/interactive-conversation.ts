import { YACHIYO_SOUL } from '@shared/personas/yachiyo'
import { createMessage, type Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { getSession, updateSessionWithMessages } from '@/stores/chatStore'
import { buildLive2DActionPrompt, type Live2DAction } from './live2d-models'

const PROMPT_START = '<!-- yachiyo-live2d-actions:start -->'
const PROMPT_END = '<!-- yachiyo-live2d-actions:end -->'

export async function applyLive2DPromptToSession(sessionId: string, actions: Live2DAction[]): Promise<void> {
  const session = await getSession(sessionId)
  if (!session) return
  const systemIndex = session.messages.findIndex((message) => message.role === 'system')
  const current = systemIndex >= 0 ? getMessageText(session.messages[systemIndex]) : YACHIYO_SOUL
  const withoutOldBlock = current.replace(new RegExp(`${PROMPT_START}[\\s\\S]*?${PROMPT_END}`, 'g'), '').trim()
  const actionPrompt = buildLive2DActionPrompt(actions)
  const nextPrompt = actionPrompt
    ? `${withoutOldBlock}\n\n${PROMPT_START}\n${actionPrompt}\n${PROMPT_END}`
    : withoutOldBlock

  if (systemIndex >= 0 && current === nextPrompt) return
  await updateSessionWithMessages(sessionId, (latest) => {
    if (!latest) throw new Error('chat_session_not_found')
    const messages = [...latest.messages]
    const latestSystemIndex = messages.findIndex((message) => message.role === 'system')
    const systemMessage = createMessage('system', nextPrompt)
    if (latestSystemIndex >= 0) systemMessage.id = messages[latestSystemIndex].id
    if (latestSystemIndex >= 0) messages[latestSystemIndex] = systemMessage
    else messages.unshift(systemMessage)
    return { ...latest, messages } as Session
  })
}
