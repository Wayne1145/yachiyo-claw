import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildDeviceGoalContext } from './agent-goal'

function message(role: Message['role'], text: string): Message {
  return {
    id: `${role}-${text}`,
    role,
    timestamp: 1,
    contentParts: [{ type: 'text', text }],
  }
}

describe('device goal context', () => {
  it('keeps only the latest user objective and explicit local limits', () => {
    const result = buildDeviceGoalContext([
      message('user', 'old unrelated request'),
      message('assistant', 'old answer'),
      message('user', '在微信发朋友圈'),
    ])
    expect(result).toHaveLength(1)
    const text = result[0].contentParts[0]
    expect(text).toMatchObject({ type: 'text' })
    if (text.type === 'text') {
      expect(text.text).toContain('在微信发朋友圈')
      expect(text.text).toContain('"maxLocalActions":20')
      expect(text.text).toContain('"maxReplans":1')
    }
  })
})
