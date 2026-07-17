/**
 * @vitest-environment jsdom
 */
import { createMessage, type Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { mergeTaskMessagesIntoChat } from './conversation-sync'

describe('mobile conversation sync', () => {
  it('preserves the chat persona while replacing shared conversation messages', () => {
    const persona = createMessage('system', 'chat persona')
    const stale = createMessage('user', 'stale message')
    const currentUser = createMessage('user', 'current question')
    const currentAssistant = createMessage('assistant', 'current answer')
    const chat = { id: 'chat', name: 'Chat', messages: [persona, stale] } as Session

    expect(mergeTaskMessagesIntoChat(chat, [currentUser, currentAssistant])).toEqual([
      persona,
      currentUser,
      currentAssistant,
    ])
  })

  it('does not import an agent system prompt into chat mode', () => {
    const persona = createMessage('system', 'chat persona')
    const agentPrompt = createMessage('system', 'agent tools')
    const answer = createMessage('assistant', 'done')
    const chat = { id: 'chat', name: 'Chat', messages: [persona] } as Session

    expect(mergeTaskMessagesIntoChat(chat, [agentPrompt, answer])).toEqual([persona, answer])
  })
})
