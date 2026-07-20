/**
 * A small, environment-aware cache for launcher icon locations.
 *
 * PackageManager/Intent launch is always preferred by the caller.  This cache
 * is only useful for launchers that require a visible icon (or as a local
 * verification hint), so every lookup is tied to the launcher and display
 * environment that produced it.  Coordinates are retained for diagnostics,
 * but logical page/cell coordinates are the stable source of truth.
 */

export const LAUNCHER_PLACEMENT_CACHE_STORAGE_KEY = 'yachiyo.android.launcher-placement-cache.v1'
export const LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION = 1 as const
export const DEFAULT_LAUNCHER_PLACEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000

const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/

export interface PlacementBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface LauncherEnvironment {
  launcherPackage: string
  launcherVersionCode: string | number
  displayId: string | number
  orientation: 'portrait' | 'landscape'
  density: number
  gridRows: number
  gridColumns: number
}

export interface LauncherPlacement extends LauncherEnvironment {
  packageName: string
  activityName?: string
  launchActivity?: string
  pageIndex: number
  cellRow: number
  cellColumn: number
  bounds?: PlacementBounds
  confidence: number
  observedAt: number
  label?: string
  screenSignature?: string
}

export interface LauncherPlacementCacheSnapshot {
  schemaVersion: typeof LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION
  updatedAt: number
  entries: LauncherPlacement[]
}

export interface LauncherPlacementCacheStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
  delStoreValue?(key: string): Promise<void>
}

export interface LauncherPlacementCacheOptions {
  storage?: LauncherPlacementCacheStorage
  now?: () => number
  ttlMs?: number
  storageKey?: string
}

export interface PlacementObservation {
  packageName?: string
  activityName?: string
  launchActivity?: string
  label?: string
  bounds?: PlacementBounds
  pageIndex?: number
  cellRow?: number
  cellColumn?: number
  screenSignature?: string
}

export type PlacementVerifier = (
  placement: LauncherPlacement
) => Promise<false | PlacementObservation> | false | PlacementObservation

function normalizeIdentifier(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

function normalizeOrientation(value: unknown): LauncherEnvironment['orientation'] | null {
  const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
  return normalized === 'portrait' || normalized === 'landscape' ? normalized : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBounds(value: unknown): PlacementBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const bounds = value as Partial<PlacementBounds>
  const { left, top, right, bottom } = bounds
  if (!isFiniteNumber(left) || !isFiniteNumber(top) || !isFiniteNumber(right) || !isFiniteNumber(bottom)) {
    return undefined
  }
  if (right < left || bottom < top) return undefined
  return {
    left,
    top,
    right,
    bottom,
  }
}

function normalizePackageName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const packageName = value.trim()
  return PACKAGE_NAME_PATTERN.test(packageName) ? packageName : null
}

function normalizeGridDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) return null
  return value
}

/** Return a canonical representation suitable for persistence and keying. */
export function normalizeLauncherEnvironment(value: LauncherEnvironment): LauncherEnvironment | null {
  if (!value || typeof value !== 'object') return null
  const launcherPackage = normalizePackageName(value.launcherPackage)
  const launcherVersionCode = normalizeIdentifier(value.launcherVersionCode)
  const displayId = normalizeIdentifier(value.displayId)
  const orientation = normalizeOrientation(value.orientation)
  const density = value.density
  const gridRows = normalizeGridDimension(value.gridRows)
  const gridColumns = normalizeGridDimension(value.gridColumns)
  if (
    !launcherPackage ||
    !launcherVersionCode ||
    !displayId ||
    !orientation ||
    !isFiniteNumber(density) ||
    density <= 0 ||
    !gridRows ||
    !gridColumns
  ) {
    return null
  }
  return {
    launcherPackage,
    launcherVersionCode,
    displayId,
    orientation,
    density: Math.round(density * 1_000) / 1_000,
    gridRows,
    gridColumns,
  }
}

/** The key intentionally excludes the app package so one environment can hold many icons. */
export function createLauncherEnvironmentKey(environment: LauncherEnvironment): string {
  const normalized = normalizeLauncherEnvironment(environment)
  if (!normalized) throw new Error('invalid_launcher_environment')
  return [
    normalized.launcherPackage,
    normalized.launcherVersionCode,
    normalized.displayId,
    normalized.orientation,
    normalized.density,
    normalized.gridRows,
    normalized.gridColumns,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|')
}

export const launcherEnvironmentKey = createLauncherEnvironmentKey

export function isLauncherEnvironmentCompatible(
  placement: LauncherPlacement,
  environment: LauncherEnvironment
): boolean {
  const normalized = normalizeLauncherEnvironment(environment)
  if (!normalized) return false
  const placementEnvironment = normalizeLauncherEnvironment(placement)
  if (!placementEnvironment) return false
  return createLauncherEnvironmentKey(placementEnvironment) === createLauncherEnvironmentKey(normalized)
}

export function isPlacementFresh(
  placement: LauncherPlacement,
  now: number,
  ttlMs = DEFAULT_LAUNCHER_PLACEMENT_TTL_MS
): boolean {
  if (!isFiniteNumber(placement.observedAt) || !isFiniteNumber(now)) return false
  return now - placement.observedAt < Math.max(0, ttlMs)
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function boundsCenter(bounds: PlacementBounds): { x: number; y: number } {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  }
}

function boundsMatch(expected: PlacementBounds, actual: PlacementBounds): boolean {
  const expectedCenter = boundsCenter(expected)
  const actualCenter = boundsCenter(actual)
  const expectedWidth = Math.max(1, expected.right - expected.left)
  const expectedHeight = Math.max(1, expected.bottom - expected.top)
  const tolerance = Math.max(expectedWidth, expectedHeight) * 1.25
  return (
    Math.abs(expectedCenter.x - actualCenter.x) <= tolerance && Math.abs(expectedCenter.y - actualCenter.y) <= tolerance
  )
}

/**
 * Compare a fresh Accessibility observation with a cached icon.  Missing
 * optional observation fields are treated as unknown rather than a mismatch.
 */
export function placementMatchesObservation(placement: LauncherPlacement, observation: PlacementObservation): boolean {
  if (!hasPlacementEvidence(observation)) return false
  if (observation.packageName && observation.packageName !== placement.packageName) return false
  const observedActivity = observation.launchActivity || observation.activityName
  const placedActivity = placement.launchActivity || placement.activityName
  if (observedActivity && (!placedActivity || observedActivity !== placedActivity)) return false
  if (observation.label) {
    if (!placement.label || normalizeLabel(observation.label) !== normalizeLabel(placement.label)) return false
  }
  if (
    observation.screenSignature &&
    (!placement.screenSignature || observation.screenSignature !== placement.screenSignature)
  ) {
    return false
  }
  if (observation.pageIndex !== undefined && observation.pageIndex !== placement.pageIndex) return false
  if (observation.cellRow !== undefined && observation.cellRow !== placement.cellRow) return false
  if (observation.cellColumn !== undefined && observation.cellColumn !== placement.cellColumn) return false
  if (observation.bounds && placement.bounds && !boundsMatch(placement.bounds, observation.bounds)) return false
  return true
}

/** A verifier must return at least one comparable app identity, not `{}`/`true`. */
function hasPlacementEvidence(observation: PlacementObservation): boolean {
  if (!observation || typeof observation !== 'object') return false
  const packageName = normalizePackageName(observation.packageName)
  const activityValue = observation.launchActivity || observation.activityName
  const activity = typeof activityValue === 'string' ? normalizeIdentifier(activityValue) : ''
  const label = typeof observation.label === 'string' ? normalizeLabel(observation.label) : ''
  return Boolean(packageName || activity || label)
}

function hasPlacementVerificationEvidence(placement: LauncherPlacement, observation: PlacementObservation): boolean {
  return Boolean(
    placement.label &&
      normalizeLabel(placement.label) &&
      placement.screenSignature &&
      observation.label &&
      normalizeLabel(observation.label) &&
      observation.screenSignature
  )
}

function normalizePlacement(value: unknown): LauncherPlacement | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<LauncherPlacement>
  const environment = normalizeLauncherEnvironment(record as LauncherEnvironment)
  const packageName = normalizePackageName(record.packageName)
  const activityName =
    typeof record.activityName === 'string' && record.activityName.trim()
      ? record.activityName.trim()
      : typeof record.launchActivity === 'string' && record.launchActivity.trim()
        ? record.launchActivity.trim()
        : undefined
  const pageIndex = record.pageIndex
  const cellRow = record.cellRow
  const cellColumn = record.cellColumn
  const confidence = record.confidence
  const observedAt = record.observedAt
  if (
    !environment ||
    !packageName ||
    !isFiniteNumber(pageIndex) ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    !isFiniteNumber(cellRow) ||
    !Number.isInteger(cellRow) ||
    cellRow < 0 ||
    !isFiniteNumber(cellColumn) ||
    !Number.isInteger(cellColumn) ||
    cellColumn < 0 ||
    !isFiniteNumber(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !isFiniteNumber(observedAt)
  ) {
    return null
  }
  if (cellRow >= environment.gridRows || cellColumn >= environment.gridColumns) return null
  const bounds = normalizeBounds(record.bounds)
  const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim().slice(0, 512) : undefined
  const screenSignature =
    typeof record.screenSignature === 'string' && record.screenSignature.trim()
      ? record.screenSignature.trim().slice(0, 512)
      : undefined
  return {
    ...environment,
    packageName,
    ...(activityName ? { activityName } : {}),
    ...(activityName ? { launchActivity: activityName } : {}),
    pageIndex,
    cellRow,
    cellColumn,
    ...(bounds ? { bounds } : {}),
    confidence,
    observedAt,
    ...(label ? { label } : {}),
    ...(screenSignature ? { screenSignature } : {}),
  }
}

function parseSnapshot(value: unknown): LauncherPlacementCacheSnapshot {
  let candidate: unknown = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      candidate = null
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return { schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION, updatedAt: 0, entries: [] }
  }
  const record = candidate as Record<string, unknown>
  if (record.schemaVersion !== LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION || !Array.isArray(record.entries)) {
    return { schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION, updatedAt: 0, entries: [] }
  }
  const entries = record.entries.map(normalizePlacement).filter((entry): entry is LauncherPlacement => Boolean(entry))
  const updatedAt = isFiniteNumber(record.updatedAt) ? record.updatedAt : 0
  return { schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION, updatedAt, entries }
}

async function loadDefaultStorage(): Promise<LauncherPlacementCacheStorage> {
  const module = await import('@/platform')
  return module.default as LauncherPlacementCacheStorage
}

function placementKey(placement: LauncherPlacement): string {
  return `${createLauncherEnvironmentKey(placement)}\u0000${placement.packageName}\u0000${placement.launchActivity || placement.activityName || ''}`
}

export class LauncherPlacementCache {
  private storage: LauncherPlacementCacheStorage | null
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly storageKey: string
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(options: LauncherPlacementCacheOptions = {}) {
    this.storage = options.storage || null
    this.now = options.now || (() => Date.now())
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_LAUNCHER_PLACEMENT_TTL_MS)
    this.storageKey = options.storageKey || LAUNCHER_PLACEMENT_CACHE_STORAGE_KEY
  }

  private async getStorage(): Promise<LauncherPlacementCacheStorage> {
    if (!this.storage) this.storage = await loadDefaultStorage()
    return this.storage
  }

  async loadSnapshot(): Promise<LauncherPlacementCacheSnapshot> {
    const value = await (await this.getStorage()).getStoreValue(this.storageKey)
    return parseSnapshot(value)
  }

  private async saveSnapshot(snapshot: LauncherPlacementCacheSnapshot): Promise<void> {
    await (await this.getStorage()).setStoreValue(this.storageKey, snapshot)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async list(environment?: LauncherEnvironment): Promise<LauncherPlacement[]> {
    const snapshot = await this.loadSnapshot()
    if (!environment) return snapshot.entries
    const normalized = normalizeLauncherEnvironment(environment)
    if (!normalized) return []
    return snapshot.entries.filter((entry) => isLauncherEnvironmentCompatible(entry, normalized))
  }

  async get(packageName: string, environment: LauncherEnvironment): Promise<LauncherPlacement | null> {
    const normalizedPackage = normalizePackageName(packageName)
    if (!normalizedPackage || !normalizeLauncherEnvironment(environment)) return null
    const entries = await this.list(environment)
    const candidate = entries
      .filter((entry) => entry.packageName === normalizedPackage && isPlacementFresh(entry, this.now(), this.ttlMs))
      .sort((a, b) => b.confidence - a.confidence || b.observedAt - a.observedAt)[0]
    return candidate || null
  }

  async getVerified(
    packageName: string,
    environment: LauncherEnvironment,
    verifier: PlacementVerifier
  ): Promise<LauncherPlacement | null> {
    const candidate = await this.get(packageName, environment)
    if (!candidate) return null
    try {
      const result = await verifier(candidate)
      const valid =
        result !== false &&
        hasPlacementVerificationEvidence(candidate, result) &&
        placementMatchesObservation(candidate, result)
      if (valid) return candidate
    } catch {
      // Treat a failed local observation as invalid and force a fresh lookup.
    }
    await this.invalidate(candidate.packageName, environment)
    return null
  }

  put(placement: LauncherPlacement): Promise<LauncherPlacement> {
    return this.enqueue(async () => {
      const normalized = normalizePlacement(placement)
      if (!normalized) throw new Error('invalid_launcher_placement')
      const snapshot = await this.loadSnapshot()
      const key = placementKey(normalized)
      const entries = snapshot.entries.filter((entry) => placementKey(entry) !== key)
      entries.push(normalized)
      await this.saveSnapshot({
        schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION,
        updatedAt: this.now(),
        entries,
      })
      return normalized
    })
  }

  async invalidate(packageName: string, environment?: LauncherEnvironment): Promise<void> {
    await this.enqueue(async () => {
      const normalizedPackage = normalizePackageName(packageName)
      if (!normalizedPackage) return
      const normalizedEnvironment = environment ? normalizeLauncherEnvironment(environment) : undefined
      const snapshot = await this.loadSnapshot()
      const entries = snapshot.entries.filter((entry) => {
        if (entry.packageName !== normalizedPackage) return true
        return normalizedEnvironment ? !isLauncherEnvironmentCompatible(entry, normalizedEnvironment) : false
      })
      if (entries.length === snapshot.entries.length) return
      await this.saveSnapshot({
        schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION,
        updatedAt: this.now(),
        entries,
      })
    })
  }

  async invalidateEnvironment(environment: LauncherEnvironment): Promise<void> {
    await this.enqueue(async () => {
      const normalized = normalizeLauncherEnvironment(environment)
      if (!normalized) return
      const snapshot = await this.loadSnapshot()
      const entries = snapshot.entries.filter((entry) => !isLauncherEnvironmentCompatible(entry, normalized))
      if (entries.length === snapshot.entries.length) return
      await this.saveSnapshot({
        schemaVersion: LAUNCHER_PLACEMENT_CACHE_SCHEMA_VERSION,
        updatedAt: this.now(),
        entries,
      })
    })
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      const storage = await this.getStorage()
      if (storage.delStoreValue) await storage.delStoreValue(this.storageKey)
      else await storage.setStoreValue(this.storageKey, null)
    })
  }
}

export function createLauncherPlacementCache(options: LauncherPlacementCacheOptions = {}): LauncherPlacementCache {
  return new LauncherPlacementCache(options)
}
