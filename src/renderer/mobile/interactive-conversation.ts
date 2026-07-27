import { YACHIYO_SOUL } from '@shared/personas/yachiyo'
import { createMessage, type Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { getSession, updateSessionWithMessages } from '@/stores/chatStore'
import type { ModelInterface } from '@shared/models/types'
import { registerBuiltinPromptBlocks } from '@/features/builtin-prompt-blocks'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { renderPromptBlocks } from '@/features/prompt-registry'
import { replaceSessionPromptBlock } from '@/features/session-prompt-block'
import type { Live2DAction } from './live2d-models'

export async function applyLive2DPromptToSession(sessionId: string, actions: Live2DAction[]): Promise<void> {
  const session = await getSession(sessionId)
  if (!session) return
  const systemIndex = session.messages.findIndex((message) => message.role === 'system')
  const current = systemIndex >= 0 ? getMessageText(session.messages[systemIndex]) : YACHIYO_SOUL
  registerBuiltinPromptBlocks()
  const actionPrompt = renderPromptBlocks('session-system', {
    model: {} as ModelInterface,
    messages: session.messages,
    platformType: 'mobile',
    enabledFeatureIds: getEnabledFeatureIds(),
    featureOptions: { interactive: { actions } },
  })
  const nextPrompt = replaceSessionPromptBlock(current, 'yachiyo-live2d-actions', actionPrompt || null)

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
