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
    const file = {
      name: 'demo.txt',
      path: '/tmp/demo.txt',
      size: 123,
      lastModified: 456,
    } as File

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:/tmp/demo.txt-123-456')
  })

  it('falls back to file name when path is unavailable', () => {
    const file = {
      name: 'demo.txt',
      size: 123,
      lastModified: 456,
    } as File

    expect(StorageKeyGenerator.fileUniqKey(file)).toBe('file:demo.txt-123-456')
  })

  it('builds stable link uniq keys', () => {
    expect(StorageKeyGenerator.linkUniqKey('https://example.com/a')).toBe('link:https://example.com/a')
  })
})
