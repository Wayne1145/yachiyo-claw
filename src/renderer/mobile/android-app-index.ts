/**
 * Local index of launchable Android applications.
 *
 * The index deliberately knows nothing about the UI or an agent plan.  It
 * resolves a user-facing app name to a package locally, then delegates the
 * actual launch to an injected native bridge.  This keeps app lookup out of
 * the model context and makes the module straightforward to test on desktop.
 */

export const ANDROID_APP_INDEX_STORAGE_KEY = 'yachiyo.android.launchable-app-index.v1'
export const ANDROID_APP_ALIAS_STORAGE_KEY = 'yachiyo.android.launchable-app-aliases.v1'
export const ANDROID_APP_INDEX_SCHEMA_VERSION = 1 as const
export const ANDROID_APP_ALIAS_SCHEMA_VERSION = 1 as const
export const DEFAULT_ANDROID_APP_INDEX_TTL_MS = 24 * 60 * 60 * 1_000

const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const MAX_LABEL_LENGTH = 512
const MAX_ALIAS_LENGTH = 128
const MAX_ALIAS_COUNT = 20

export interface LaunchableApp {
  packageName: string
  /** Android activity name; `launchActivity` is retained for older bridges. */
  activityName?: string
  launchActivity?: string
  label: string
  aliases?: string[]
  versionCode?: string | number
  updatedAt?: number
}

export interface AndroidAppIndexSnapshot {
  schemaVersion: typeof ANDROID_APP_INDEX_SCHEMA_VERSION
  refreshedAt: number
  apps: LaunchableApp[]
}

export interface AndroidAppIndexStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
  delStoreValue?(key: string): Promise<void>
}

export interface AndroidAppIndexNative {
  /**
   * Implemented by the Android PackageManager bridge.  `getLaunchableApps`
   * is accepted as a compatibility alias for bridges built against an older
   * name while the native plugin is being rolled out.
   */
  listLaunchableApps?: () => Promise<LaunchableAppsResponse>
  getLaunchableApps?: () => Promise<LaunchableAppsResponse>
  launchApp?: (
    app: Pick<LaunchableApp, 'packageName' | 'activityName' | 'launchActivity'>
  ) => Promise<NativeLaunchResult | boolean | undefined>
}

export type LaunchableAppsResponse =
  | readonly LaunchableApp[]
  | {
      apps?: readonly LaunchableApp[]
      count?: number
      observedAt?: number
    }

let defaultInvalidationListener: Promise<unknown> | null = null

function extractLaunchableApps(response: LaunchableAppsResponse): readonly LaunchableApp[] {
  if (Array.isArray(response)) return response
  if (response && typeof response === 'object' && 'apps' in response && Array.isArray(response.apps)) {
    return response.apps
  }
  return []
}

export interface NativeLaunchResult {
  success: boolean
  output?: string
  error?: string
}

export type LocalLaunchMethod = 'intent' | 'launcher_search' | 'verified_placement' | 'manual'

export interface LocalLaunchOutcome extends NativeLaunchResult {
  method: LocalLaunchMethod
}

export interface LocalLaunchFallbacks {
  /** A local launcher search implementation; this callback must not call a model. */
  launcherSearch?: () => Promise<NativeLaunchResult | boolean | undefined>
  /** A placement-cache hit that has already passed one local verification. */
  verifiedPlacement?: () => Promise<NativeLaunchResult | boolean | undefined>
  manualFallback?: () => Promise<NativeLaunchResult | boolean | undefined>
}

export async function executeLocalLaunchOrder(
  intentLaunch: () => Promise<NativeLaunchResult | boolean | undefined>,
  fallbacks: LocalLaunchFallbacks = {}
): Promise<LocalLaunchOutcome> {
  const isTerminalFailure = (result: NativeLaunchResult): boolean => {
    const error = result.error || ''
    return error === 'already_applied' || error.startsWith('recovery_required:')
  }
  const run = async (callback: () => Promise<NativeLaunchResult | boolean | undefined>) => {
    try {
      return normalizeLaunchResult(await callback())
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AgentBudgetExceededError' ||
          error.name === 'AbortError' ||
          error.message.includes('agent_action_deadline_exceeded') ||
          error.message.includes('agent_action_cancelled'))
      ) {
        throw error
      }
      return { success: false, error: error instanceof Error ? error.message : 'launch_failed' }
    }
  }
  const intent = await run(intentLaunch)
  if (intent.success) return { ...intent, method: 'intent' }
  if (isTerminalFailure(intent)) return { ...intent, method: 'intent' }

  if (fallbacks.launcherSearch) {
    const searched = await run(fallbacks.launcherSearch)
    if (searched.success) return { ...searched, method: 'launcher_search' }
    if (isTerminalFailure(searched)) return { ...searched, method: 'launcher_search' }
  }
  if (fallbacks.verifiedPlacement) {
    const placed = await run(fallbacks.verifiedPlacement)
    if (placed.success) return { ...placed, method: 'verified_placement' }
    if (isTerminalFailure(placed)) return { ...placed, method: 'verified_placement' }
  }
  if (fallbacks.manualFallback) {
    const manual = await run(fallbacks.manualFallback)
    if (manual.success) return { ...manual, method: 'manual' }
    if (isTerminalFailure(manual)) return { ...manual, method: 'manual' }
  }
  return { success: false, error: intent.error || 'launcher_fallback_required', method: 'manual' }
}

export interface AndroidAppIndexOptions {
  storage?: AndroidAppIndexStorage
  native?: AndroidAppIndexNative
  now?: () => number
  ttlMs?: number
  storageKey?: string
  aliasStorageKey?: string
}

export interface AppIndexMatchOptions {
  /** Minimum score required for a result. Defaults to 0.55. */
  minScore?: number
  /** Results this close to the best score are considered ambiguous. */
  ambiguityDelta?: number
}

export type AppMatchField = 'package' | 'label' | 'alias' | 'prefix' | 'contains' | 'fuzzy'

export interface RankedLaunchableApp {
  app: LaunchableApp
  score: number
  matchedBy: AppMatchField
}

export type AppResolution =
  | {
      kind: 'resolved'
      query: string
      app: LaunchableApp
      score: number
      matchedBy: AppMatchField
    }
  | {
      kind: 'ambiguous'
      query: string
      candidates: RankedLaunchableApp[]
    }
  | {
      kind: 'not_found'
      query: string
      candidates: RankedLaunchableApp[]
    }

export class AppIndexResolutionError extends Error {
  public readonly resolution: AppResolution

  constructor(resolution: AppResolution) {
    super(resolution.kind === 'ambiguous' ? 'app_query_ambiguous' : 'app_not_found')
    this.name = 'AppIndexResolutionError'
    this.resolution = resolution
  }
}

/** Normalize labels without losing Chinese characters or Latin words. */
export function normalizeAppQuery(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeDisplayText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value.trim() : fallback
  return text.slice(0, MAX_LABEL_LENGTH)
}

function normalizePackageName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const packageName = value.trim()
  return PACKAGE_NAME_PATTERN.test(packageName) ? packageName : null
}

function normalizeAliasList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const candidate of value) {
    if (aliases.length >= MAX_ALIAS_COUNT) break
    if (typeof candidate !== 'string') continue
    const alias = candidate.trim().slice(0, MAX_ALIAS_LENGTH)
    const normalized = normalizeAppQuery(alias)
    if (!alias || !normalized || normalized === normalizeAppQuery(label) || seen.has(normalized)) continue
    seen.add(normalized)
    aliases.push(alias)
  }
  return aliases
}

function normalizeVersionCode(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 128)
  return undefined
}

/** Sanitize and deduplicate records received from PackageManager. */
export function normalizeLaunchableApps(apps: readonly LaunchableApp[]): LaunchableApp[] {
  const byKey = new Map<string, LaunchableApp>()

  for (const raw of apps) {
    const packageName = normalizePackageName(raw?.packageName)
    if (!packageName) continue
    const label = normalizeDisplayText(raw?.label, packageName)
    const launchActivity = normalizeDisplayText(raw?.launchActivity || raw?.activityName).slice(0, 512) || undefined
    const aliases = normalizeAliasList(raw?.aliases, label)
    const versionCode = normalizeVersionCode(raw?.versionCode)
    const updatedAt = typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined
    const key = `${packageName}\u0000${launchActivity || ''}`
    const existing = byKey.get(key)

    if (!existing) {
      byKey.set(key, {
        packageName,
        ...(launchActivity ? { launchActivity } : {}),
        ...(launchActivity ? { activityName: launchActivity } : {}),
        label,
        ...(aliases.length ? { aliases } : {}),
        ...(versionCode !== undefined ? { versionCode } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
      })
      continue
    }

    const mergedAliases = normalizeAliasList([...(existing.aliases || []), ...aliases], existing.label || label)
    // Prefer the non-package label and the newest metadata when duplicate
    // launch activities are returned by different PackageManager queries.
    const preferredLabel = existing.label === existing.packageName && label !== packageName ? label : existing.label
    byKey.set(key, {
      ...existing,
      label: preferredLabel || label,
      ...(launchActivity ? { launchActivity, activityName: launchActivity } : {}),
      ...(mergedAliases.length ? { aliases: mergedAliases } : { aliases: undefined }),
      ...(versionCode !== undefined ? { versionCode } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    })
  }

  return [...byKey.values()].sort((a, b) => {
    const labelOrder = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    return labelOrder || a.packageName.localeCompare(b.packageName)
  })
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  // Keep only two rows; app labels are short and this avoids allocating a
  // matrix for every record during a local search.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    ;[previous, current] = [current, previous]
  }
  return previous[b.length]
}

function scoreField(query: string, field: string): { score: number; matchedBy: AppMatchField } | null {
  if (!field) return null
  if (query === field) return { score: 1, matchedBy: 'label' }
  if (field.startsWith(query))
    return { score: 0.9 - Math.min(0.08, (field.length - query.length) * 0.002), matchedBy: 'prefix' }
  if (field.includes(query)) return { score: 0.78 - Math.min(0.08, field.indexOf(query) * 0.01), matchedBy: 'contains' }
  if (query.length >= 2 && field.length <= 96) {
    const similarity = 1 - levenshteinDistance(query, field) / Math.max(query.length, field.length)
    if (similarity >= 0.55) return { score: 0.5 + similarity * 0.25, matchedBy: 'fuzzy' }
  }
  return null
}

function scoreApp(query: string, app: LaunchableApp): RankedLaunchableApp | null {
  const packageName = normalizeAppQuery(app.packageName)
  if (query === packageName) return { app, score: 1, matchedBy: 'package' }

  const fields: Array<{ value: string; kind: 'label' | 'alias' }> = [
    { value: normalizeAppQuery(app.label), kind: 'label' },
    ...(app.aliases || []).map((alias) => ({ value: normalizeAppQuery(alias), kind: 'alias' as const })),
  ]
  let best: RankedLaunchableApp | null = null
  for (const field of fields) {
    const scored = scoreField(query, field.value)
    if (!scored) continue
    const matchedBy: AppMatchField = scored.matchedBy === 'label' ? field.kind : scored.matchedBy
    const candidate = { app, score: scored.score, matchedBy }
    if (!best || candidate.score > best.score) best = candidate
  }
  return best
}

export function rankLaunchableApps(
  query: string,
  apps: readonly LaunchableApp[],
  options: AppIndexMatchOptions = {}
): RankedLaunchableApp[] {
  const normalizedQuery = normalizeAppQuery(query)
  if (!normalizedQuery) return []
  const minScore = options.minScore ?? 0.55
  const bestByPackage = new Map<string, RankedLaunchableApp>()
  for (const candidate of apps
    .map((app) => scoreApp(normalizedQuery, app))
    .filter((entry): entry is RankedLaunchableApp => Boolean(entry && entry.score >= minScore))) {
    const existing = bestByPackage.get(candidate.app.packageName)
    if (
      !existing ||
      candidate.score > existing.score ||
      (candidate.score === existing.score &&
        (candidate.app.launchActivity || candidate.app.activityName || '') <
          (existing.app.launchActivity || existing.app.activityName || ''))
    ) {
      bestByPackage.set(candidate.app.packageName, candidate)
    }
  }
  return [...bestByPackage.values()].sort(
    (a, b) => b.score - a.score || a.app.label.localeCompare(b.app.label, undefined, { sensitivity: 'base' })
  )
}

export function resolveLaunchableApp(
  query: string,
  apps: readonly LaunchableApp[],
  options: AppIndexMatchOptions = {}
): AppResolution {
  const candidates = rankLaunchableApps(query, apps, options).slice(0, 8)
  if (!candidates.length) return { kind: 'not_found', query, candidates: [] }

  const ambiguityDelta = options.ambiguityDelta ?? 0.06
  const [best, second] = candidates
  if (second && best.score - second.score < ambiguityDelta) {
    return { kind: 'ambiguous', query, candidates }
  }
  return {
    kind: 'resolved',
    query,
    app: best.app,
    score: best.score,
    matchedBy: best.matchedBy,
  }
}

function parseSnapshot(value: unknown): AndroidAppIndexSnapshot | null {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  if (record.schemaVersion !== ANDROID_APP_INDEX_SCHEMA_VERSION || !Array.isArray(record.apps)) return null
  if (typeof record.refreshedAt !== 'number' || !Number.isFinite(record.refreshedAt)) return null
  return {
    schemaVersion: ANDROID_APP_INDEX_SCHEMA_VERSION,
    refreshedAt: record.refreshedAt,
    apps: normalizeLaunchableApps(record.apps as LaunchableApp[]),
  }
}

interface AppAliasRecord {
  packageName: string
  aliases: string[]
}

interface AppAliasSnapshot {
  schemaVersion: typeof ANDROID_APP_ALIAS_SCHEMA_VERSION
  entries: AppAliasRecord[]
}

function parseAliasSnapshot(value: unknown): Map<string, string[]> {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return new Map()
    }
  }
  if (!candidate || typeof candidate !== 'object') return new Map()
  const record = candidate as Partial<AppAliasSnapshot>
  if (record.schemaVersion !== ANDROID_APP_ALIAS_SCHEMA_VERSION || !Array.isArray(record.entries)) return new Map()

  const aliasesByPackage = new Map<string, string[]>()
  for (const raw of record.entries) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Partial<AppAliasRecord>
    const packageName = normalizePackageName(entry.packageName)
    if (!packageName) continue
    const aliases = normalizeAliasList(entry.aliases, '')
    if (aliases.length) aliasesByPackage.set(packageName, aliases)
  }
  return aliasesByPackage
}

function serializeAliasSnapshot(aliasesByPackage: Map<string, string[]>): AppAliasSnapshot {
  return {
    schemaVersion: ANDROID_APP_ALIAS_SCHEMA_VERSION,
    entries: [...aliasesByPackage.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 512)
      .map(([packageName, aliases]) => ({ packageName, aliases: aliases.slice(0, MAX_ALIAS_COUNT) })),
  }
}

function mergePersistedAliases(
  apps: readonly LaunchableApp[],
  aliasesByPackage: Map<string, string[]>
): LaunchableApp[] {
  return apps.map((app) => {
    const aliases = normalizeAliasList(
      [...(app.aliases || []), ...(aliasesByPackage.get(app.packageName) || [])],
      app.label
    )
    return aliases.length ? { ...app, aliases } : app
  })
}

async function loadDefaultStorage(): Promise<AndroidAppIndexStorage> {
  const module = await import('@/platform')
  const storage = module.default as AndroidAppIndexStorage
  if (!defaultInvalidationListener) {
    defaultInvalidationListener = import('@/platform/native/yachiyo_device_access')
      .then((nativeModule) =>
        nativeModule.yachiyoDeviceAccessNative.onLaunchableAppsChanged((event) => {
          void storage.setStoreValue(ANDROID_APP_INDEX_STORAGE_KEY, null)
          if (event.packageName) {
            void import('./launcher-placement-cache').then(({ createLauncherPlacementCache }) =>
              createLauncherPlacementCache({ storage }).invalidate(event.packageName)
            )
          }
        })
      )
      .catch(() => {
        defaultInvalidationListener = null
      })
  }
  return storage
}

async function loadDefaultNative(): Promise<AndroidAppIndexNative> {
  const module = await import('@/platform/native/yachiyo_device_access')
  const native = module.yachiyoDeviceAccessNative as unknown as AndroidAppIndexNative
  const listNativeApps = native.listLaunchableApps || native.getLaunchableApps
  return {
    listLaunchableApps: async (): Promise<LaunchableAppsResponse> => {
      if (!listNativeApps) throw new Error('launchable_apps_unavailable')
      const result = await listNativeApps()
      const records = extractLaunchableApps(result)
      return records.map((record: LaunchableApp) => ({
        ...record,
        launchActivity: record.launchActivity || record.activityName,
        activityName: record.activityName || record.launchActivity,
      }))
    },
    launchApp: async (app) => {
      if (typeof module.yachiyoDeviceAccessNative.launchApp === 'function') {
        const result = await module.yachiyoDeviceAccessNative.launchApp(
          app.packageName,
          app.launchActivity || app.activityName
        )
        if (typeof result === 'boolean') return { success: result }
        if (!result) return { success: false, error: 'empty_launch_result' }
        return result
      }
      const result = await module.yachiyoDeviceAccessNative.accessibilityAction({
        action: 'launch',
        packageName: app.packageName,
      })
      return { success: result.success, output: result.output }
    },
  }
}

function normalizeLaunchResult(result: NativeLaunchResult | boolean | undefined): NativeLaunchResult {
  if (typeof result === 'boolean') return { success: result }
  if (!result) return { success: false, error: 'empty_launch_result' }
  if (typeof result.success === 'boolean') return result
  return { success: false, error: 'invalid_launch_result' }
}

export class AndroidAppIndex {
  private readonly native?: AndroidAppIndexNative
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly storageKey: string
  private readonly aliasStorageKey: string
  private storage: AndroidAppIndexStorage | null
  private refreshPromise: Promise<LaunchableApp[]> | null = null
  private processValidated = false

  constructor(options: AndroidAppIndexOptions = {}) {
    this.native = options.native
    this.now = options.now || (() => Date.now())
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_ANDROID_APP_INDEX_TTL_MS)
    this.storageKey = options.storageKey || ANDROID_APP_INDEX_STORAGE_KEY
    this.aliasStorageKey =
      options.aliasStorageKey ||
      (this.storageKey === ANDROID_APP_INDEX_STORAGE_KEY ? ANDROID_APP_ALIAS_STORAGE_KEY : `${this.storageKey}.aliases`)
    this.storage = options.storage || null
  }

  private async getStorage(): Promise<AndroidAppIndexStorage> {
    if (!this.storage) this.storage = await loadDefaultStorage()
    return this.storage
  }

  private getNative(): Promise<AndroidAppIndexNative> {
    return this.native ? Promise.resolve(this.native) : loadDefaultNative()
  }

  private async loadAliases(): Promise<Map<string, string[]>> {
    const value = await (await this.getStorage()).getStoreValue(this.aliasStorageKey)
    return parseAliasSnapshot(value)
  }

  private async saveAliases(aliasesByPackage: Map<string, string[]>): Promise<void> {
    await (await this.getStorage()).setStoreValue(this.aliasStorageKey, serializeAliasSnapshot(aliasesByPackage))
  }

  async loadSnapshot(): Promise<AndroidAppIndexSnapshot | null> {
    const value = await (await this.getStorage()).getStoreValue(this.storageKey)
    return parseSnapshot(value)
  }

  private isFresh(snapshot: AndroidAppIndexSnapshot): boolean {
    return this.now() - snapshot.refreshedAt < this.ttlMs
  }

  async list(options: { forceRefresh?: boolean } = {}): Promise<LaunchableApp[]> {
    const snapshot = await this.loadSnapshot()
    // A process can be killed while Android package broadcasts are in flight.
    // Validate once after startup so a fresh persisted snapshot cannot outlive
    // an install, uninstall, or update that happened while the renderer was dead.
    if (!this.processValidated) {
      this.processValidated = true
      try {
        return await this.refresh()
      } catch (error) {
        if (!snapshot) throw error
      }
    }
    if (!options.forceRefresh && snapshot && this.isFresh(snapshot)) return snapshot.apps

    try {
      return await this.refresh()
    } catch (error) {
      // A stale index is still safer and more useful than forcing the agent
      // to explore the launcher.  Callers can force a refresh explicitly.
      if (snapshot) return snapshot.apps
      throw error
    }
  }

  async refresh(): Promise<LaunchableApp[]> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.performRefresh()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async performRefresh(): Promise<LaunchableApp[]> {
    const previous = await this.loadSnapshot()
    const native = await this.getNative()
    const list = native.listLaunchableApps || native.getLaunchableApps
    if (!list) throw new Error('launchable_apps_unavailable')
    const result = await list()
    const records = extractLaunchableApps(result)
    const apps = mergePersistedAliases(normalizeLaunchableApps(records), await this.loadAliases())
    const snapshot: AndroidAppIndexSnapshot = {
      schemaVersion: ANDROID_APP_INDEX_SCHEMA_VERSION,
      refreshedAt: this.now(),
      apps,
    }
    await (await this.getStorage()).setStoreValue(this.storageKey, snapshot)
    if (previous) await this.invalidateChangedPlacements(previous.apps, apps)
    return apps
  }

  private async invalidateChangedPlacements(
    previousApps: readonly LaunchableApp[],
    currentApps: readonly LaunchableApp[]
  ): Promise<void> {
    const currentByPackage = new Map(currentApps.map((app) => [app.packageName, app]))
    const changed = new Set(
      previousApps
        .filter((app) => {
          const current = currentByPackage.get(app.packageName)
          return (
            !current ||
            current.versionCode !== app.versionCode ||
            (current.launchActivity || current.activityName) !== (app.launchActivity || app.activityName)
          )
        })
        .map((app) => app.packageName)
    )
    if (!changed.size) return
    const storage = await this.getStorage()
    const { createLauncherPlacementCache } = await import('./launcher-placement-cache')
    const placementCache = createLauncherPlacementCache({ storage })
    for (const packageName of changed) await placementCache.invalidate(packageName)
  }

  async invalidate(): Promise<void> {
    const storage = await this.getStorage()
    if (storage.delStoreValue) {
      await storage.delStoreValue(this.storageKey)
    } else {
      await storage.setStoreValue(this.storageKey, null)
    }
  }

  async resolve(query: string, options: AppIndexMatchOptions = {}): Promise<AppResolution> {
    return resolveLaunchableApp(query, await this.list(), options)
  }

  async setAlias(packageName: string, alias: string): Promise<LaunchableApp> {
    const normalizedPackage = normalizePackageName(packageName)
    const trimmedAlias = alias.trim().slice(0, MAX_ALIAS_LENGTH)
    if (!normalizedPackage || !trimmedAlias || !normalizeAppQuery(trimmedAlias)) throw new Error('invalid_app_alias')

    const snapshot = await this.loadSnapshot()
    const apps = snapshot?.apps || (await this.list())
    const index = apps.findIndex((app) => app.packageName === normalizedPackage)
    if (index < 0) throw new Error('app_not_found')
    const aliasesByPackage = await this.loadAliases()
    const existingAliases = aliasesByPackage.get(normalizedPackage) || []
    aliasesByPackage.set(normalizedPackage, normalizeAliasList([...existingAliases, trimmedAlias], apps[index].label))
    await this.saveAliases(aliasesByPackage)
    const nextApps = mergePersistedAliases(apps, aliasesByPackage)
    const updated = nextApps[index]
    await (await this.getStorage()).setStoreValue(this.storageKey, {
      schemaVersion: ANDROID_APP_INDEX_SCHEMA_VERSION,
      refreshedAt: snapshot?.refreshedAt ?? this.now(),
      apps: nextApps,
    } satisfies AndroidAppIndexSnapshot)
    return updated
  }

  async launch(target: string | LaunchableApp, options: AppIndexMatchOptions = {}): Promise<NativeLaunchResult> {
    const app = typeof target === 'string' ? await this.resolveTarget(target, options) : target
    return this.launchResolvedApp(app)
  }

  async launchWithFallback(
    target: string | LaunchableApp,
    fallbacks: LocalLaunchFallbacks = {},
    options: AppIndexMatchOptions = {}
  ): Promise<LocalLaunchOutcome> {
    const app = typeof target === 'string' ? await this.resolveTarget(target, options) : target
    return executeLocalLaunchOrder(() => this.launchResolvedApp(app), fallbacks)
  }

  async launchResolvedApp(app: LaunchableApp): Promise<NativeLaunchResult> {
    const packageName = normalizePackageName(app.packageName)
    if (!packageName) return { success: false, error: 'invalid_package_name' }
    const native = await this.getNative()
    if (!native.launchApp) {
      throw new Error('app_launch_unavailable')
    }
    try {
      return normalizeLaunchResult(
        await native.launchApp({
          packageName,
          launchActivity: app.launchActivity,
          activityName: app.activityName || app.launchActivity,
        })
      )
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'app_launch_failed',
      }
    }
  }

  private async resolveTarget(query: string, options: AppIndexMatchOptions): Promise<LaunchableApp> {
    const resolution = await this.resolve(query, options)
    if (resolution.kind !== 'resolved') throw new AppIndexResolutionError(resolution)
    return resolution.app
  }
}

export function createAndroidAppIndex(options: AndroidAppIndexOptions = {}): AndroidAppIndex {
  if (Object.keys(options).length > 0) return new AndroidAppIndex(options)
  return getDefaultAndroidAppIndex()
}

let defaultAndroidAppIndex: AndroidAppIndex | null = null

function getDefaultAndroidAppIndex(): AndroidAppIndex {
  if (!defaultAndroidAppIndex) defaultAndroidAppIndex = new AndroidAppIndex()
  return defaultAndroidAppIndex
}
