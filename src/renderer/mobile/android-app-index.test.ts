import { describe, expect, it, vi } from 'vitest'
import {
  AndroidAppIndex,
  type AndroidAppIndexStorage,
  AppIndexResolutionError,
  executeLocalLaunchOrder,
  type LaunchableApp,
  normalizeAppQuery,
  normalizeLaunchableApps,
  rankLaunchableApps,
  resolveLaunchableApp,
} from './android-app-index'
import { LauncherPlacementCache } from './launcher-placement-cache'

class MemoryStore implements AndroidAppIndexStorage {
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

const apps: LaunchableApp[] = [
  { packageName: 'com.tencent.mm', label: '微信', aliases: ['WeChat'] },
  { packageName: 'com.sina.weibo', label: '微博', aliases: ['Weibo'] },
  { packageName: 'com.google.android.apps.maps', label: 'Google Maps', aliases: ['地图'] },
]

describe('android app index matching', () => {
  it('normalizes Chinese and Latin labels consistently', () => {
    expect(normalizeAppQuery('  ＷｅＣｈａｔ  ')).toBe('wechat')
    expect(normalizeAppQuery('Google　Maps')).toBe('googlemaps')
    expect(normalizeAppQuery('微信')).toBe('微信')
  })

  it('normalizes and deduplicates PackageManager records', () => {
    expect(
      normalizeLaunchableApps([
        { packageName: ' com.test.app ', label: ' Test ', aliases: ['Alias', ' alias '] },
        { packageName: 'com.test.app', label: 'Test', aliases: ['Second'] },
        { packageName: 'not a package', label: 'ignored' },
      ])
    ).toEqual([
      {
        packageName: 'com.test.app',
        label: 'Test',
        aliases: ['Alias', 'Second'],
      },
    ])
  })

  it('resolves exact package, label, and alias matches locally', () => {
    expect(resolveLaunchableApp('com.tencent.mm', apps)).toMatchObject({
      kind: 'resolved',
      app: apps[0],
      matchedBy: 'package',
      score: 1,
    })
    expect(resolveLaunchableApp('微信', apps)).toMatchObject({ kind: 'resolved', app: apps[0], matchedBy: 'label' })
    expect(resolveLaunchableApp('wechat', apps)).toMatchObject({ kind: 'resolved', app: apps[0], matchedBy: 'alias' })
  })

  it('supports fuzzy matching while retaining an ambiguity result for close candidates', () => {
    expect(resolveLaunchableApp('wecaht', apps)).toMatchObject({ kind: 'resolved', app: apps[0] })

    const similar = [
      { packageName: 'com.example.alpha', label: 'Alpha Chat' },
      { packageName: 'com.example.beta', label: 'Alpha Notes' },
    ]
    const resolution = resolveLaunchableApp('alpha', similar)
    expect(resolution.kind).toBe('ambiguous')
    if (resolution.kind === 'ambiguous') expect(resolution.candidates).toHaveLength(2)
  })

  it('returns ranked candidates for a caller that wants to present a choice', () => {
    const ranked = rankLaunchableApps('google', apps)
    expect(ranked[0]).toMatchObject({ app: apps[2], matchedBy: 'prefix' })
    expect(ranked[0].score).toBeGreaterThan(ranked[1]?.score || 0)
  })
})

describe('local app launch order', () => {
  it('prefers PackageManager intent, then local launcher search, then verified placement', async () => {
    const calls: string[] = []
    await expect(
      executeLocalLaunchOrder(
        () => {
          calls.push('intent')
          return Promise.resolve({ success: false, error: 'no_intent' })
        },
        {
          launcherSearch: () => {
            calls.push('search')
            return Promise.resolve({ success: false })
          },
          verifiedPlacement: () => {
            calls.push('placement')
            return Promise.resolve({ success: true, output: 'clicked' })
          },
          manualFallback: () => {
            calls.push('manual')
            return Promise.resolve({ success: true })
          },
        }
      )
    ).resolves.toMatchObject({ success: true, method: 'verified_placement' })
    expect(calls).toEqual(['intent', 'search', 'placement'])
  })

  it('does not run a fallback after an applied or unknown launch checkpoint', async () => {
    const calls: string[] = []
    await expect(
      executeLocalLaunchOrder(
        () => {
          calls.push('intent')
          return Promise.resolve({ success: false, error: 'recovery_required:unknown' })
        },
        {
          launcherSearch: () => {
            calls.push('search')
            return Promise.resolve({ success: true })
          },
        }
      )
    ).resolves.toMatchObject({ success: false, method: 'intent', error: 'recovery_required:unknown' })
    expect(calls).toEqual(['intent'])
  })
})

describe('AndroidAppIndex cache and native boundary', () => {
  it('refreshes once, reuses a fresh cache, and refreshes after TTL expiry', async () => {
    let now = 1_000
    const storage = new MemoryStore()
    const listLaunchableApps = vi
      .fn<() => Promise<readonly LaunchableApp[]>>()
      .mockResolvedValueOnce(apps)
      .mockResolvedValueOnce([apps[1]])
    const index = new AndroidAppIndex({
      storage,
      native: { listLaunchableApps },
      ttlMs: 100,
      now: () => now,
    })

    const normalizedApps = [...apps].sort((a, b) => a.label.localeCompare(b.label))
    await expect(index.list()).resolves.toEqual(normalizedApps)
    await expect(index.list()).resolves.toEqual(normalizedApps)
    expect(listLaunchableApps).toHaveBeenCalledTimes(1)

    now = 1_101
    await expect(index.list()).resolves.toEqual([apps[1]])
    expect(listLaunchableApps).toHaveBeenCalledTimes(2)
  })

  it('uses a stale cache if a refresh is unavailable, avoiding launcher exploration', async () => {
    let now = 1_000
    const storage = new MemoryStore()
    const index = new AndroidAppIndex({
      storage,
      native: { listLaunchableApps: vi.fn().mockResolvedValue(apps) },
      ttlMs: 10,
      now: () => now,
    })
    await index.list()

    now = 2_000
    const staleIndex = new AndroidAppIndex({
      storage,
      native: { listLaunchableApps: vi.fn().mockRejectedValue(new Error('package_manager_unavailable')) },
      ttlMs: 10,
      now: () => now,
    })
    await expect(staleIndex.list()).resolves.toEqual([...apps].sort((a, b) => a.label.localeCompare(b.label)))
  })

  it('persists user aliases and launches the resolved package through the injected bridge', async () => {
    const storage = new MemoryStore()
    const launchApp = vi.fn().mockResolvedValue({ success: true, output: 'launched' })
    const index = new AndroidAppIndex({
      storage,
      native: { listLaunchableApps: vi.fn().mockResolvedValue(apps), launchApp },
    })

    await index.list()
    await index.setAlias('com.tencent.mm', '聊天')
    expect(await index.resolve('聊天')).toMatchObject({ kind: 'resolved', app: { packageName: apps[0].packageName } })
    await expect(index.launch('聊天')).resolves.toEqual({ success: true, output: 'launched' })
    expect(launchApp).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: 'com.tencent.mm', launchActivity: undefined })
    )
  })

  it('treats an empty native launch response as a failure', async () => {
    const index = new AndroidAppIndex({
      storage: new MemoryStore(),
      native: {
        listLaunchableApps: vi.fn().mockResolvedValue(apps),
        launchApp: vi.fn().mockResolvedValue(undefined),
      },
    })

    await expect(index.launch('微信')).resolves.toEqual({ success: false, error: 'empty_launch_result' })
  })

  it('retains user aliases when PackageManager refreshes the app list', async () => {
    let now = 1_000
    const storage = new MemoryStore()
    const listLaunchableApps = vi
      .fn<() => Promise<readonly LaunchableApp[]>>()
      .mockResolvedValueOnce([{ packageName: 'com.tencent.mm', label: '微信' }])
      .mockResolvedValue([{ packageName: 'com.tencent.mm', label: '微信', aliases: [] }])
    const index = new AndroidAppIndex({
      storage,
      native: { listLaunchableApps },
      ttlMs: 10,
      now: () => now,
    })

    await index.list()
    await index.setAlias('com.tencent.mm', '聊天')
    now = 1_011

    await expect(index.resolve('聊天')).resolves.toMatchObject({
      kind: 'resolved',
      app: { packageName: 'com.tencent.mm', aliases: ['聊天'] },
    })
    expect(listLaunchableApps).toHaveBeenCalledTimes(2)

    await index.invalidate()
    await expect(index.resolve('聊天')).resolves.toMatchObject({ kind: 'resolved' })
    expect(listLaunchableApps).toHaveBeenCalledTimes(3)
  })

  it('invalidates launcher placements when an indexed app version changes', async () => {
    let now = 1_000
    const storage = new MemoryStore()
    const listLaunchableApps = vi
      .fn<() => Promise<readonly LaunchableApp[]>>()
      .mockResolvedValueOnce([{ packageName: 'com.tencent.mm', label: '微信', versionCode: 1 }])
      .mockResolvedValueOnce([{ packageName: 'com.tencent.mm', label: '微信', versionCode: 2 }])
    const index = new AndroidAppIndex({ storage, native: { listLaunchableApps }, ttlMs: 10, now: () => now })
    const placements = new LauncherPlacementCache({ storage, now: () => now })

    await index.list()
    await placements.put({
      launcherPackage: 'com.android.launcher3',
      launcherVersionCode: 1,
      displayId: 0,
      orientation: 'portrait',
      density: 2.75,
      gridRows: 6,
      gridColumns: 5,
      packageName: 'com.tencent.mm',
      pageIndex: 0,
      cellRow: 1,
      cellColumn: 1,
      confidence: 0.9,
      observedAt: now,
      label: '微信',
      screenSignature: 'launcher-page-0',
    })

    now = 1_011
    await index.list()
    await expect(placements.list()).resolves.toEqual([])
  })

  it('requires explicit disambiguation instead of launching a similarly named app', async () => {
    const storage = new MemoryStore()
    const launchApp = vi.fn().mockResolvedValue({ success: true })
    const index = new AndroidAppIndex({
      storage,
      native: {
        listLaunchableApps: vi.fn().mockResolvedValue([
          { packageName: 'com.example.one', label: '工具' },
          { packageName: 'com.example.two', label: '工具' },
        ]),
        launchApp,
      },
    })

    await expect(index.launch('工具')).rejects.toMatchObject({
      name: AppIndexResolutionError.name,
      resolution: { kind: 'ambiguous' },
    })
    expect(launchApp).not.toHaveBeenCalled()
  })
})
