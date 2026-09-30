import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/platform', () => ({
  default: {
    getStorageType: () => 'web',
    setStoreValue: async () => undefined,
    getStoreValue: async () => undefined,
    delStoreValue: async () => undefined,
    getAllStoreValues: async () => ({}),
    getAllStoreKeys: async () => [],
    setAllStoreValues: async () => undefined,
    setStoreBlob: async () => undefined,
    getStoreBlob: async () => null,
    delStoreBlob: async () => undefined,
    listStoreBlobKeys: async () => [],
  },
}))

let StorageKeyGenerator: typeof import('./StoreStorage').StorageKeyGenerator

beforeAll(async () => {
  ;({ StorageKeyGenerator } = await import('./StoreStorage'))
})

describe('StorageKeyGenerator', () => {
  it('builds stable file uniq keys', () => {
    const file = Object.assign(new File([new Uint8Array(123)], 'demo.txt', { lastModified: 456 }), {
      path: '/tmp/demo.txt',
    })

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:/tmp/demo.txt-123-456')
  })

  it('falls back to file name when path is unavailable', () => {
    const file = new File([new Uint8Array(123)], 'demo.txt', { lastModified: 456 })

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:demo.txt-123-456')
  })

  it('builds stable link uniq keys', () => {
    expect(StorageKeyGenerator.linkUniqKey('https://example.com/a')).toBe('link:https://example.com/a')
  })
})
