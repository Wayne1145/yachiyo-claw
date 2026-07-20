import { describe, expect, it, vi } from 'vitest'
import {
  createLauncherEnvironmentKey,
  isLauncherEnvironmentCompatible,
  isPlacementFresh,
  type LauncherEnvironment,
  type LauncherPlacement,
  LauncherPlacementCache,
  type LauncherPlacementCacheStorage,
  placementMatchesObservation,
} from './launcher-placement-cache'

class MemoryStore implements LauncherPlacementCacheStorage {
  private values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }

  delStoreValue(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }
}

const portrait: LauncherEnvironment = {
  launcherPackage: 'com.android.launcher3',
  launcherVersionCode: 42,
  displayId: 0,
  orientation: 'portrait',
  density: 2.75,
  gridRows: 6,
  gridColumns: 5,
}

const landscape: LauncherEnvironment = { ...portrait, orientation: 'landscape' }

function placement(overrides: Partial<LauncherPlacement> = {}): LauncherPlacement {
  return {
    ...portrait,
    packageName: 'com.tencent.mm',
    activityName: 'com.tencent.mm.ui.LauncherUI',
    pageIndex: 2,
    cellRow: 3,
    cellColumn: 1,
    bounds: { left: 100, top: 200, right: 180, bottom: 280 },
    confidence: 0.92,
    observedAt: 1_000,
    label: '微信',
    screenSignature: 'launcher:page-2',
    ...overrides,
  }
}

describe('launcher placement helpers', () => {
  it('keys the logical launcher environment, not absolute icon pixels', () => {
    expect(createLauncherEnvironmentKey(portrait)).toBe(createLauncherEnvironmentKey({ ...portrait }))
    expect(createLauncherEnvironmentKey(portrait)).not.toBe(createLauncherEnvironmentKey(landscape))
    expect(isLauncherEnvironmentCompatible(placement(), portrait)).toBe(true)
    expect(isLauncherEnvironmentCompatible(placement(), { ...portrait, gridColumns: 4 })).toBe(false)
  })

  it('treats future timestamps as fresh and expires old placements by TTL', () => {
    expect(isPlacementFresh(placement({ observedAt: 2_000 }), 1_000, 100)).toBe(true)
    expect(isPlacementFresh(placement({ observedAt: 500 }), 1_000, 100)).toBe(false)
    expect(isPlacementFresh(placement({ observedAt: 900 }), 1_000, 100)).toBe(false)
  })

  it('matches a verified accessibility observation with tolerant bounds', () => {
    const cached = placement()
    expect(
      placementMatchesObservation(cached, {
        packageName: cached.packageName,
        screenSignature: cached.screenSignature,
        label: '微信',
        bounds: { left: 108, top: 207, right: 188, bottom: 287 },
      })
    ).toBe(true)
    expect(placementMatchesObservation(cached, { packageName: 'com.sina.weibo' })).toBe(false)
    expect(placementMatchesObservation(cached, { screenSignature: 'launcher:other-page' })).toBe(false)
  })
})

describe('LauncherPlacementCache', () => {
  it('stores and retrieves a logical page/cell placement for the same environment', async () => {
    const cache = new LauncherPlacementCache({ storage: new MemoryStore(), now: () => 1_000, ttlMs: 500 })
    await cache.put(placement())

    await expect(cache.get('com.tencent.mm', portrait)).resolves.toMatchObject({
      pageIndex: 2,
      cellRow: 3,
      cellColumn: 1,
      confidence: 0.92,
    })
    await expect(cache.get('com.tencent.mm', landscape)).resolves.toBeNull()
  })

  it('invalidates a moved/changed icon after one failed local verification', async () => {
    const storage = new MemoryStore()
    const cache = new LauncherPlacementCache({ storage, now: () => 1_000, ttlMs: 500 })
    await cache.put(placement())
    const verifier = vi.fn().mockResolvedValue({ packageName: 'com.sina.weibo' })

    await expect(cache.getVerified('com.tencent.mm', portrait, verifier)).resolves.toBeNull()
    expect(verifier).toHaveBeenCalledTimes(1)
    await expect(cache.get('com.tencent.mm', portrait)).resolves.toBeNull()
  })

  it('invalidates a placement after an explicit verifier failure', async () => {
    const cache = new LauncherPlacementCache({ storage: new MemoryStore(), now: () => 1_000, ttlMs: 500 })
    await cache.put(placement())
    const verifier = vi.fn().mockResolvedValue(false)

    await expect(cache.getVerified('com.tencent.mm', portrait, verifier)).resolves.toBeNull()
    expect(verifier).toHaveBeenCalledTimes(1)
    await expect(cache.get('com.tencent.mm', portrait)).resolves.toBeNull()
  })

  it('rejects package-only evidence without an icon label and page signature', async () => {
    const cache = new LauncherPlacementCache({ storage: new MemoryStore(), now: () => 1_000, ttlMs: 500 })
    await cache.put(placement())

    await expect(
      cache.getVerified('com.tencent.mm', portrait, () => ({ packageName: 'com.tencent.mm' }))
    ).resolves.toBeNull()
    await expect(cache.get('com.tencent.mm', portrait)).resolves.toBeNull()
  })

  it('does not return expired entries and can invalidate all entries for an app', async () => {
    let now = 1_000
    const cache = new LauncherPlacementCache({ storage: new MemoryStore(), now: () => now, ttlMs: 100 })
    await cache.put(placement())
    now = 1_101
    await expect(cache.get('com.tencent.mm', portrait)).resolves.toBeNull()

    await cache.put(placement({ observedAt: now }))
    await cache.invalidate('com.tencent.mm')
    await expect(cache.list()).resolves.toEqual([])
  })

  it('ignores malformed persisted records rather than risking an old coordinate click', async () => {
    const storage = new MemoryStore()
    await storage.setStoreValue('cache', {
      schemaVersion: 1,
      updatedAt: 1,
      entries: [
        placement(),
        { ...placement(), pageIndex: -1 },
        { ...placement(), cellRow: portrait.gridRows },
        { ...placement(), confidence: 2 },
        { packageName: 'bad package' },
      ],
    })
    const cache = new LauncherPlacementCache({ storage, storageKey: 'cache', now: () => 1_000 })
    await expect(cache.list()).resolves.toHaveLength(1)
  })
})
