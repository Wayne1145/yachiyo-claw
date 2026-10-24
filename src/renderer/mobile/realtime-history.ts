import type { Message } from '@shared/types'

/** Update in place, and insert late ASR transcripts by event time without moving the system prompt. */
export function upsertRealtimeMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((item) => item.id === message.id)
  if (index >= 0)
    return messages.map((item) => (item.id === message.id ? { ...message, timestamp: item.timestamp } : item))
  const before = messages.findIndex(
    (item) => item.role !== 'system' && (item.timestamp || 0) > (message.timestamp || 0)
  )
  if (before < 0) return [...messages, message]
  return [...messages.slice(0, before), message, ...messages.slice(before)]
}
