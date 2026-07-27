import { compareVersions } from 'compare-versions'
import { parsePluginManifest, type PluginManifest } from '@shared/plugins/manifest'
import {
  PluginInstallError,
  type PluginSource,
  type VerifiedPluginPackage,
  type VerifyPluginPackageInput,
  verifyPluginPackage,
} from '@shared/plugins/verify'
import { unpackPluginArchive } from './unpack'
import { PLUGIN_STORAGE_LIMITS } from '@shared/plugins/storage'

/**
 * Plugin installer (platform-27).
 *
 * Runs the full pipeline — unpack → verify (shared security core) → stage → atomically commit — with
 * storage and registry behind small injected interfaces so the pure flow is unit-testable and the
 * Capacitor-backed implementations stay thin. Ordering invariants:
 * - Nothing is written anywhere until the whole package has been verified.
 * - Files land in a staging directory first; the plugin only becomes visible via one atomic rename.
 *   Any failure before commit removes the staging directory — no half-installed plugin ever exists.
 * - Registry registration happens only after the rename succeeds; if registration itself fails, the
 *   committed directory is rolled back too.
 * - Reinstalling the same version and package downgrades are rejected. Updates use immutable version
 *   directories; the registry pointer changes only after bytes are durable.
 * - No auto-update, no run-on-install: this module only lands bytes and registers metadata.
 */

export interface InstalledPluginVersion {
  manifest: PluginManifest
  packageSha256: string
  signatureVerified: boolean
  signerKeyId?: string
  deviceGrantAllowed: boolean
  source: PluginSource
  installedAt: number
  unpackedBytes?: number
  /** User-selected update origin. It is metadata only; every fetched package is re-verified. */
  updateSource?: PluginUpdateSource
  /** Versioned code directory. Missing only on records created before the versioned installer. */
  installDir?: string
}

export interface PluginUpdateSource {
  kind: 'marketplace' | 'url'
  url: string
}

export interface InstalledPluginRecord extends InstalledPluginVersion {
  enabled?: boolean
  /** Previous verified versions retained for an atomic registry-pointer rollback. */
  previousVersions?: InstalledPluginVersion[]
}

/** Filesystem seam. Paths are plugin-storage-relative; the impl roots them under Directory.Data. */
export interface PluginFileStore {
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  /** Atomic within the store root. Replaces `to` if it exists. */
  rename(from: string, to: string): Promise<void>
  removeDir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

export interface PluginRegistryStore {
  get(pluginId: string): Promise<InstalledPluginRecord | null>
  put(record: InstalledPluginRecord): Promise<void>
  remove(pluginId: string): Promise<void>
  list?(): Promise<InstalledPluginRecord[]>
}

export interface InstallPluginInput {
  packageBytes: ArrayBuffer | Uint8Array
  source: PluginSource
  expectedSha256?: string
  signature?: VerifyPluginPackageInput['signature']
  appVersion?: string
  now?: number
  updateSource?: PluginUpdateSource
}

export const PLUGINS_DIR = 'yachiyo-plugins'
export const PLUGIN_VERSIONS_DIR = 'yachiyo-plugin-versions'
export const MAX_RETAINED_PLUGIN_VERSIONS = 3

function requirePluginId(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) throw new PluginInstallError('Invalid plugin id.', 'manifest')
  return value
}

function parsePluginUpdateSource(value: unknown): PluginUpdateSource | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin_update_source_invalid')
  const raw = value as Record<string, unknown>
  if ((raw.kind !== 'marketplace' && raw.kind !== 'url') || typeof raw.url !== 'string' || raw.url.length > 2048)
    throw new Error('plugin_update_source_invalid')
  let url: URL
  try {
    url = new URL(raw.url)
  } catch {
    throw new Error('plugin_update_source_invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('plugin_update_source_invalid')
  return { kind: raw.kind, url: url.toString() }
}

export function pluginInstallDir(record: InstalledPluginVersion): string {
  return record.installDir ?? `${PLUGINS_DIR}/${record.manifest.id}`
}

/** Prevents an update from silently replacing a trusted publisher with weaker or unrelated code. */
export function assertPluginUpdateProvenance(
  current: InstalledPluginRecord,
  candidate: Pick<VerifiedPluginPackage, 'source' | 'signatureVerified' | 'signerKeyId'>
): void {
  if (current.source === 'marketplace' && candidate.source !== 'marketplace') {
    throw new PluginInstallError('Marketplace plugins can only be updated from the verified marketplace.', 'signature')
  }
  if (current.signatureVerified && !candidate.signatureVerified) {
    throw new PluginInstallError('A verified plugin cannot be replaced by an unsigned update.', 'signature')
  }
  if (current.signerKeyId && candidate.signerKeyId !== current.signerKeyId) {
    throw new PluginInstallError('The update publisher does not match the installed plugin.', 'signature')
  }
}

/** Rejects same-version reinstalls and downgrades before the consent sheet is shown. */
export function assertPluginVersionUpgrade(
  current: Pick<InstalledPluginRecord, 'manifest'>,
  candidate: Pick<PluginManifest, 'id' | 'version'>,
): void {
  let comparison: number
  try {
    comparison = compareVersions(candidate.version, current.manifest.version)
  } catch {
    throw new PluginInstallError(`Plugin "${candidate.id}" has an invalid version string.`, 'manifest')
  }
  if (comparison === 0) {
    throw new PluginInstallError(
      `Plugin "${candidate.id}" v${current.manifest.version} is already installed.`,
      'manifest',
    )
  }
  if (comparison < 0) {
    throw new PluginInstallError(
      'Installing an older package is blocked; use the retained-version rollback action.',
      'manifest',
    )
  }
}

function parseInstalledVersion(value: unknown, expectedPluginId?: string): InstalledPluginVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin_record_invalid')
  const raw = value as Record<string, unknown>
  const manifest = parsePluginManifest(raw.manifest)
  if (expectedPluginId && manifest.id !== expectedPluginId) throw new Error('plugin_record_identity_mismatch')
  if (typeof raw.packageSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.packageSha256))
    throw new Error('plugin_record_hash_invalid')
  if (typeof raw.signatureVerified !== 'boolean' || typeof raw.deviceGrantAllowed !== 'boolean')
    throw new Error('plugin_record_trust_invalid')
  if (!['marketplace', 'https', 'sideload'].includes(String(raw.source)))
    throw new Error('plugin_record_source_invalid')
  if (!Number.isSafeInteger(raw.installedAt) || Number(raw.installedAt) < 0)
    throw new Error('plugin_record_time_invalid')
  if (raw.signerKeyId !== undefined && (typeof raw.signerKeyId !== 'string' || raw.signerKeyId.length > 384)) {
    throw new Error('plugin_record_signer_invalid')
  }
  if (
    raw.unpackedBytes !== undefined &&
    (!Number.isSafeInteger(raw.unpackedBytes) ||
      Number(raw.unpackedBytes) < 0 ||
      Number(raw.unpackedBytes) > PLUGIN_STORAGE_LIMITS.maxPluginCodeBytes)
  )
    throw new Error('plugin_record_size_invalid')
  const installDir = raw.installDir
  if (installDir !== undefined) {
    const prefix = `${PLUGIN_VERSIONS_DIR}/${manifest.id}/`
    const legacy = `${PLUGINS_DIR}/${manifest.id}`
    const versionKey =
      typeof installDir === 'string' && installDir.startsWith(prefix) ? installDir.slice(prefix.length) : ''
    if (typeof installDir !== 'string' || (installDir !== legacy && !/^[a-f0-9]{16}-\d+$/.test(versionKey))) {
      throw new Error('plugin_record_path_invalid')
    }
  }
  const updateSource = parsePluginUpdateSource(raw.updateSource)
  return {
    manifest,
    packageSha256: raw.packageSha256,
    signatureVerified: raw.signatureVerified,
    signerKeyId: raw.signerKeyId as string | undefined,
    deviceGrantAllowed: raw.deviceGrantAllowed,
    source: raw.source as PluginSource,
    installedAt: raw.installedAt as number,
    unpackedBytes: raw.unpackedBytes as number | undefined,
    ...(updateSource ? { updateSource } : {}),
    installDir: installDir as string | undefined,
  }
}

/** Validates untrusted IndexedDB registry data before it can influence a filesystem path. */
export function parseInstalledPluginRecord(value: unknown, expectedPluginId?: string): InstalledPluginRecord {
  const current = parseInstalledVersion(value, expectedPluginId)
  const raw = value as Record<string, unknown>
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error('plugin_record_enabled_invalid')
  if (raw.previousVersions !== undefined && !Array.isArray(raw.previousVersions))
    throw new Error('plugin_record_history_invalid')
  const previous = (raw.previousVersions ?? []) as unknown[]
  if (previous.length > MAX_RETAINED_PLUGIN_VERSIONS) throw new Error('plugin_record_history_invalid')
  return {
    ...current,
    enabled: raw.enabled as boolean | undefined,
    previousVersions: previous.map((version) => parseInstalledVersion(version, current.manifest.id)),
  }
}

function versionSnapshot(record: InstalledPluginVersion): InstalledPluginVersion {
  return {
    manifest: record.manifest,
    packageSha256: record.packageSha256,
    signatureVerified: record.signatureVerified,
    signerKeyId: record.signerKeyId,
    deviceGrantAllowed: record.deviceGrantAllowed,
    source: record.source,
    installedAt: record.installedAt,
    unpackedBytes: record.unpackedBytes,
    ...(record.updateSource ? { updateSource: record.updateSource } : {}),
    installDir: pluginInstallDir(record),
  }
}

function installedVersionBytes(record: InstalledPluginVersion): number {
  return record.unpackedBytes ?? record.manifest.files.reduce((total, file) => total + file.size, 0)
}

function installedRecordBytes(record: InstalledPluginRecord): number {
  return (
    installedVersionBytes(record) +
    (record.previousVersions ?? []).reduce((total, version) => total + installedVersionBytes(version), 0)
  )
}

export class PluginInstaller {
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly fileStore: PluginFileStore,
    private readonly registry: PluginRegistryStore,
  ) {}

  /** Unpacks and verifies without touching disk — the preview step the consent UI runs first. */
  async inspect(input: InstallPluginInput): Promise<VerifiedPluginPackage> {
    const files = await unpackPluginArchive(input.packageBytes)
    return verifyPluginPackage({
      packageBytes: input.packageBytes,
      files,
      source: input.source,
      expectedSha256: input.expectedSha256,
      signature: input.signature,
      appVersion: input.appVersion,
    })
  }

  /**
   * Installs a fully-verified package. Call `inspect` first and obtain user consent between the two —
   * this method re-verifies from the same bytes rather than trusting a possibly-stale preview.
   */
  async install(input: InstallPluginInput): Promise<InstalledPluginRecord> {
    return this.withMutation(() => this.installUnlocked(input))
  }

  private async installUnlocked(input: InstallPluginInput): Promise<InstalledPluginRecord> {
    const verified = await this.inspect(input)
    const pluginId = verified.manifest.id

    const existing = await this.registry.get(pluginId)
    if (existing) {
      assertPluginUpdateProvenance(existing, verified)
      assertPluginVersionUpgrade(existing, verified.manifest)
      // A newer version proceeds as a user-initiated update. Grants remain digest-bound and are
      // explicitly rebound only after the consent transaction succeeds.
    }

    const installedAt = input.now ?? Date.now()
    // Code directories are immutable. Only the registry pointer changes, so an interrupted update can
    // never remove the version the registry still considers active.
    const versionKey = `${verified.packageSha256.slice(0, 16)}-${installedAt}`
    const finalDir = `${PLUGIN_VERSIONS_DIR}/${pluginId}/${versionKey}`
    const stagingDir = `${PLUGIN_VERSIONS_DIR}/${pluginId}/.staging-${versionKey}`
    const allPreviousVersions = existing
      ? [versionSnapshot(existing), ...(existing.previousVersions ?? []).map(versionSnapshot)]
      : []
    const record: InstalledPluginRecord = {
      manifest: verified.manifest,
      packageSha256: verified.packageSha256,
      signatureVerified: verified.signatureVerified,
      signerKeyId: verified.signerKeyId,
      deviceGrantAllowed: verified.deviceGrantAllowed,
      source: verified.source,
      installedAt,
      unpackedBytes: verified.unpackedBytes,
      ...(input.updateSource ? { updateSource: parsePluginUpdateSource(input.updateSource) } : {}),
      installDir: finalDir,
      enabled: existing?.enabled ?? true,
      previousVersions: allPreviousVersions.slice(0, MAX_RETAINED_PLUGIN_VERSIONS),
    }
    if (this.registry.list) {
      const otherBytes = (await this.registry.list())
        .filter((installed) => installed.manifest.id !== pluginId)
        .reduce((total, installed) => total + installedRecordBytes(installed), 0)
      if (otherBytes + installedRecordBytes(record) > PLUGIN_STORAGE_LIMITS.maxTotalBytes) {
        throw new PluginInstallError('plugin_total_code_quota_exceeded', 'files')
      }
    }

    try {
      for (const [path, bytes] of verified.files) {
        await this.fileStore.writeFile(`${stagingDir}/${path}`, bytes)
      }
      await this.fileStore.rename(stagingDir, finalDir)
    } catch (error) {
      // Nothing committed: remove only this version's stage. The active record and bytes are untouched.
      await this.fileStore.removeDir(stagingDir).catch(() => {})
      throw error instanceof PluginInstallError
        ? error
        : new PluginInstallError(
            `Failed to write plugin files: ${error instanceof Error ? error.message : 'io error'}`,
            'archive',
          )
    }

    try {
      await this.registry.put(record)
    } catch (error) {
      // Files committed but registration failed: remove only the new immutable version. The old
      // registry pointer and its directory still form a valid installation.
      await this.fileStore.removeDir(finalDir).catch(() => {})
      throw new PluginInstallError(
        `Failed to register plugin: ${error instanceof Error ? error.message : 'registry error'}`,
        'manifest',
      )
    }
    for (const dropped of allPreviousVersions.slice(MAX_RETAINED_PLUGIN_VERSIONS)) {
      await this.fileStore.removeDir(pluginInstallDir(dropped)).catch(() => {})
    }
    return record
  }

  async uninstall(pluginId: string): Promise<void> {
    pluginId = requirePluginId(pluginId)
    // Registry first: if directory removal fails the plugin is already invisible, and a later
    // reinstall uses a fresh immutable version directory, so leftovers cannot become active.
    await this.registry.remove(pluginId)
    const paths = [
      `${PLUGIN_VERSIONS_DIR}/${pluginId}`,
      // Legacy pre-versioned install location.
      `${PLUGINS_DIR}/${pluginId}`,
    ]
    const residues: string[] = []
    await Promise.all(
      paths.map(async (path) => {
        try {
          await this.fileStore.removeDir(path)
          if (await this.fileStore.exists(path)) residues.push(`${path}: directory_not_removed`)
        } catch (error) {
          residues.push(`${path}: ${error instanceof Error ? error.message : 'delete_failed'}`)
        }
      })
    )
    if (residues.length > 0) {
      throw new PluginInstallError(
        `Plugin was unregistered but code cleanup is incomplete: ${residues.join('; ')}`,
        'files'
      )
    }
  }

  /** Atomically repoints the registry to a retained verified version; code bytes are never moved. */
  async rollback(pluginId: string, version?: string): Promise<InstalledPluginRecord> {
    pluginId = requirePluginId(pluginId)
    const current = await this.registry.get(pluginId)
    if (!current) throw new PluginInstallError(`Plugin "${pluginId}" is not installed.`, 'manifest')
    const history = current.previousVersions ?? []
    const index = version ? history.findIndex((entry) => entry.manifest.version === version) : 0
    if (index < 0 || !history[index])
      throw new PluginInstallError('No retained plugin version is available for rollback.', 'manifest')
    const target = history[index]
    if (!(await this.fileStore.exists(pluginInstallDir(target)))) {
      throw new PluginInstallError('The retained plugin version is missing from storage.', 'archive')
    }
    const nextHistory = [
      versionSnapshot(current),
      ...history.filter((_, itemIndex) => itemIndex !== index).map(versionSnapshot),
    ]
    const next: InstalledPluginRecord = {
      ...versionSnapshot(target),
      enabled: current.enabled ?? true,
      previousVersions: nextHistory.slice(0, MAX_RETAINED_PLUGIN_VERSIONS),
    }
    await this.registry.put(next)
    for (const dropped of nextHistory.slice(MAX_RETAINED_PLUGIN_VERSIONS)) {
      await this.fileStore.removeDir(pluginInstallDir(dropped)).catch(() => {})
    }
    return next
  }

  /** Compensating transaction used when grant persistence fails after the code pointer committed. */
  async restoreAfterFailedUpdate(previous: InstalledPluginRecord): Promise<void> {
    previous = parseInstalledPluginRecord(previous, previous.manifest.id)
    const current = await this.registry.get(previous.manifest.id)
    await this.registry.put(previous)
    if (current && pluginInstallDir(current) !== pluginInstallDir(previous)) {
      await this.fileStore.removeDir(pluginInstallDir(current)).catch(() => {})
    }
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release!: () => void
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
