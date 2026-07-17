import type { Message, MessageContentParts } from '@shared/types'

/**
 * Removes tool-call parts from messages older than the specified number of rounds.
 * A round = 1 user message + 1 assistant message pair.
 * Helps reduce context size while keeping recent tool interactions intact.
 */
export function cleanToolCalls(messages: Message[], keepRounds = 2): Message[] {
  if (messages.length === 0 || keepRounds < 0) {
    return messages.map((m) => ({ ...m }))
  }

  const roundBoundaryIndex = findRoundBoundaryIndex(messages, keepRounds)

  return messages.map((message, index) => {
    if (index >= roundBoundaryIndex) {
      return { ...message }
    }
    return removeToolCallParts(message)
  })
}

function findRoundBoundaryIndex(messages: Message[], keepRounds: number): number {
  if (keepRounds === 0) {
    return messages.length
  }

  let roundCount = 0
  let inRound = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role

    if (role === 'assistant') {
      inRound = true
    } else if (role === 'user' && inRound) {
      roundCount++
      inRound = false

      if (roundCount >= keepRounds) {
        return i
      }
    }
  }

  return 0
}

function removeToolCallParts(message: Message): Message {
  if (!message.contentParts || message.contentParts.length === 0) {
    return { ...message }
  }

  const filteredParts: MessageContentParts = message.contentParts.filter((part) => part.type !== 'tool-call')

  return {
    ...message,
    contentParts: filteredParts,
  }
}
