import { describe, expect, it } from 'vitest'
import { LongTermMemoryService } from './long-term-memory'
import {
  buildRelevantLongTermMemoryPrompt,
  extractDurableMemoryCandidates,
  rememberDurableUserStatements,
} from './automatic-memory'

function createService() {
  let value: string | null = null
  return new LongTermMemoryService(
    {
      getStoreBlob: async () => value,
      setStoreBlob: async (_key, next) => {
        value = next
      },
      delStoreBlob: async () => {
        value = null
      },
    },
    { encrypt: async (input) => input, decrypt: async (input) => input },
  )
}

describe('automatic memory', () => {
  it('extracts explicit durable facts and ignores questions or transient requests', () => {
    expect(extractDurableMemoryCandidates('请称呼我 Wayne。帮我写一个页面。你记得我吗？')).toEqual([
      expect.objectContaining({ content: '请称呼我 Wayne', kind: 'fact' }),
    ])
  })

  it('stores explicit statements and retrieves bounded prompt context', async () => {
    const service = createService()
    await expect(
      rememberDurableUserStatements('项目默认使用 pnpm。', { sessionId: 's1', messageId: 'm1' }, service),
    ).resolves.toBe(1)
    const prompt = await buildRelevantLongTermMemoryPrompt('pnpm 项目', service)
    expect(prompt).toContain('项目默认使用 pnpm')
    expect(prompt).toContain('<relevant_long_term_memory>')
  })

  it('still rejects credentials through the memory service', async () => {
    const service = createService()
    await expect(
      rememberDurableUserStatements('记住 api_key: sk-this-is-a-secret-token。', { sessionId: 's1' }, service),
    ).resolves.toBe(0)
  })
})
