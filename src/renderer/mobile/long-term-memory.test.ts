import { describe, expect, it } from 'vitest'
import { LongTermMemoryService, isSensitiveMemoryContent } from './long-term-memory'

function createMemoryStorage() {
  let value: string | null = null
  return {
    getStoreBlob: async () => value,
    setStoreBlob: async (_key: string, next: string) => {
      value = next
    },
    delStoreBlob: async () => {
      value = null
    },
  }
}

const identityCrypto = {
  encrypt: async (value: string) => value,
  decrypt: async (value: string) => value,
}

describe('LongTermMemoryService', () => {
  it('rejects secrets and sensitive candidates', async () => {
    const service = new LongTermMemoryService(createMemoryStorage(), identityCrypto)
    expect(isSensitiveMemoryContent('api_key: sk-test-secret-value')).toBe(true)
    await expect(service.saveCandidate({ content: 'api_key: sk-test-secret-value' })).resolves.toBeNull()
    await expect(service.saveCandidate({ content: 'medical diagnosis', sensitivity: 'sensitive' })).resolves.toBeNull()
  })

  it('deduplicates and searches memories by terms', async () => {
    const service = new LongTermMemoryService(createMemoryStorage(), identityCrypto)
    const first = await service.saveCandidate({ content: 'User prefers compact Android settings pages', tags: ['ui'] })
    const duplicate = await service.saveCandidate({ content: 'user prefers compact android settings pages' })
    expect(first?.id).toBe(duplicate?.id)
    await service.saveCandidate({ content: 'User works mostly in TypeScript' })
    const results = await service.search({ query: 'Android settings', limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0].item.content).toContain('Android')
  })

  it('expires records and supports user edits/removal', async () => {
    const service = new LongTermMemoryService(createMemoryStorage(), identityCrypto)
    const record = await service.saveCandidate({ content: 'Temporary preference', expiresAt: 20 }, 10)
    expect(await service.list({ now: 21 })).toHaveLength(0)
    const permanent = await service.saveCandidate({ content: 'Persistent preference' }, 10)
    const updated = await service.update(permanent!.id, { content: 'Updated preference' })
    expect(updated?.userEdited).toBe(true)
    await expect(service.remove(record!.id)).resolves.toBe(true)
  })
})
