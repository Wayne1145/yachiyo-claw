import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cache, store } from './cache'

describe('cache', () => {
  let now = 0
  let keyCounter = 0

  const nextKey = () => `cache-test-${++keyCounter}`

  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns fresh value from getter on first call', async () => {
    const key = nextKey()
    const getter = vi.fn(async () => 'fresh-value')

    const result = await cache(key, getter, { ttl: 1_000 })

    expect(result).toBe('fresh-value')
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('returns cached value within TTL without calling getter again', async () => {
    const key = nextKey()
    const getter = vi.fn(async () => 'cached-value')

    const first = await cache(key, getter, { ttl: 1_000 })
    now += 500
    const second = await cache(key, getter, { ttl: 1_000 })

    expect(first).toBe('cached-value')
    expect(second).toBe('cached-value')
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('calls getter again after TTL expires', async () => {
    const key = nextKey()
    let value = 1
    const getter = vi.fn(async () => value++)

    const first = await cache(key, getter, { ttl: 1_000 })
    now += 1_001
    const second = await cache(key, getter, { ttl: 1_000 })

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(getter).toHaveBeenCalledTimes(2)
  })

  it('works with memoryOnly option without storage access', async () => {
    const key = nextKey()
    const getter = vi.fn(async () => 'memory-only')
    const getItemSpy = vi.spyOn(store, 'getItem')
    const setItemSpy = vi.spyOn(store, 'setItem')

    const first = await cache(key, getter, { ttl: 1_000, memoryOnly: true })
    const second = await cache(key, getter, { ttl: 1_000, memoryOnly: true })

    expect(first).toBe('memory-only')
    expect(second).toBe('memory-only')
    expect(getter).toHaveBeenCalledTimes(1)
    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent calls for the same key', async () => {
    const key = nextKey()

    let resolveGetter: ((value: string) => void) | undefined
    const getter = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveGetter = resolve
        })
    )

    const firstPromise = cache(key, getter, { ttl: 1_000, memoryOnly: true })
    const secondPromise = cache(key, getter, { ttl: 1_000, memoryOnly: true })

    expect(getter).toHaveBeenCalledTimes(1)

    resolveGetter?.('shared-result')

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toBe('shared-result')
    expect(second).toBe('shared-result')
    expect(getter).toHaveBeenCalledTimes(1)
  })

  it('returns stale cache when refreshFallbackToCache is true and getter throws', async () => {
    const key = nextKey()
    const initialGetter = vi.fn(async () => 'stale-value')

    const initial = await cache(key, initialGetter, { ttl: 100, memoryOnly: true })
    expect(initial).toBe('stale-value')

    now += 101

    const failingGetter = vi.fn(async () => {
      throw new Error('refresh failed')
    })

    const result = await cache(key, failingGetter, {
      ttl: 100,
      memoryOnly: true,
      refreshFallbackToCache: true,
    })

    expect(result).toBe('stale-value')
    expect(failingGetter).toHaveBeenCalledTimes(1)
  })

  it('throws when getter fails and no valid cache without refreshFallbackToCache', async () => {
    const key = nextKey()
    const getter = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(cache(key, getter, { ttl: 1_000, memoryOnly: true })).rejects.toThrow('boom')
    expect(getter).toHaveBeenCalledTimes(1)
  })
})

describe('store', () => {
  it('falls back to memory when window is undefined', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')

    const key = `store-test-${Date.now()}`

    await store.setItem(key, 'value')
    await expect(store.getItem(key)).resolves.toBe('value')

    await store.removeItem(key)
    await expect(store.getItem(key)).resolves.toBeNull()
  })
})
