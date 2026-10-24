import { describe, expect, it } from 'vitest'
import { createMessage } from '@shared/types'
import { upsertRealtimeMessage } from './realtime-history'

describe('realtime transcript ordering', () => {
  it('keeps the system prompt first when ASR finishes after an assistant reply', () => {
    const system = { ...createMessage('system', 'persona'), id: 's', timestamp: 1000 }
    const assistant = { ...createMessage('assistant', 'reply'), id: 'a', timestamp: 200 }
    const user = { ...createMessage('user', 'speech'), id: 'u', timestamp: 100 }
    expect(upsertRealtimeMessage([system, assistant], user).map((m) => m.id)).toEqual(['s', 'u', 'a'])
  })
  it('updates a final transcript without changing its original position or timestamp', () => {
    const assistant = { ...createMessage('assistant', 'partial'), id: 'a', timestamp: 100 }
    const user = { ...createMessage('user', 'next'), id: 'u', timestamp: 200 }
    const updated = upsertRealtimeMessage([assistant, user], {
      ...assistant,
      timestamp: 300,
      contentParts: [{ type: 'text', text: 'final' }],
    })
    expect(updated.map((m) => m.id)).toEqual(['a', 'u'])
    expect(updated[0].timestamp).toBe(100)
    expect(updated[0].contentParts).toEqual([{ type: 'text', text: 'final' }])
  })
})
