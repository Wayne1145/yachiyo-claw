import { Capacitor } from '@capacitor/core'
import type { PluginMarketplaceEntry } from '@shared/plugins/marketplace'
import type { PluginSource } from '@shared/plugins/verify'
import type { SkillSignature } from '@shared/types/skills'
import type { GenericDownloadRequest } from '@/platform/native/yachiyo_downloads'
import type { PluginUpdateSource } from './installer'

const STORAGE_KEY = 'yachiyo:plugins:pending-download:v1'
const MAX_AGE_MS = 7 * 24 * 60 * 60_000

export interface PendingPluginInstall {
  schemaVersion: 1
  state: 'prepared' | 'enqueued'
  request: GenericDownloadRequest
  source: Exclude<PluginSource, 'sideload'>
  expectedSha256?: string
  signature?: SkillSignature
  updateSource?: PluginUpdateSource
  expectedPlugin?: Pick<PluginMarketplaceEntry, 'id'> & { version?: string }
  createdAt: number
}

function isSignature(value: unknown): value is SkillSignature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    (item.algorithm === 'ed25519' || item.algorithm === 'ecdsa-p256') &&
    typeof item.value === 'string' &&
    item.value.length > 0 &&
    (item.keyId === undefined || typeof item.keyId === 'string') &&
    (item.publicKey === undefined || typeof item.publicKey === 'string')
  )
}

function parsePending(value: unknown): PendingPluginInstall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const request = item.request as Record<string, unknown> | undefined
  if (
    item.schemaVersion !== 1 ||
    (item.state !== 'prepared' && item.state !== 'enqueued') ||
    (item.source !== 'https' && item.source !== 'marketplace') ||
    !Number.isSafeInteger(item.createdAt) ||
    Number(item.createdAt) <= 0 ||
    Date.now() - Number(item.createdAt) > MAX_AGE_MS ||
    !request ||
    typeof request.id !== 'string' ||
    !/^plugin-[a-f0-9]{32}$/.test(request.id) ||
    request.kind !== 'plugin' ||
    typeof request.title !== 'string' ||
    typeof request.url !== 'string' ||
    !Number.isSafeInteger(request.expectedSize) ||
    Number(request.expectedSize) <= 0
  ) return null
  if (item.signature !== undefined && !isSignature(item.signature)) return null
  if (item.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(item.expectedSha256))) return null
  const expectedPlugin = item.expectedPlugin as Record<string, unknown> | undefined
  if (
    expectedPlugin &&
    (typeof expectedPlugin.id !== 'string' ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(expectedPlugin.id) ||
      (expectedPlugin.version !== undefined && typeof expectedPlugin.version !== 'string'))
  ) return null
  const updateSource = item.updateSource as PluginUpdateSource | undefined
  if (
    updateSource &&
    ((updateSource.kind !== 'marketplace' && updateSource.kind !== 'url') ||
      typeof updateSource.url !== 'string' ||
      !updateSource.url.startsWith('https://'))
  ) return null
  return item as unknown as PendingPluginInstall
}

export function readPendingPluginInstall(): PendingPluginInstall | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = parsePending(JSON.parse(raw))
    if (!parsed) localStorage.removeItem(STORAGE_KEY)
    return parsed
  } catch {
    return null
  }
}

export function savePendingPluginInstall(value: PendingPluginInstall): void {
  if (!Capacitor.isNativePlatform()) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export function markPendingPluginInstallEnqueued(downloadId: string): void {
  const current = readPendingPluginInstall()
  if (!current || current.request.id !== downloadId || current.state === 'enqueued') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, state: 'enqueued' }))
}

export function clearPendingPluginInstall(downloadId?: string): void {
  const current = readPendingPluginInstall()
  if (!downloadId || !current || current.request.id === downloadId) localStorage.removeItem(STORAGE_KEY)
}

export async function discardPendingPluginArtifact(downloadId?: string): Promise<void> {
  if (!downloadId || !Capacitor.isNativePlatform()) return
  const { yachiyoDownloadsNative } = await import('@/platform/native/yachiyo_downloads')
  await yachiyoDownloadsNative.removeArtifact({ id: downloadId, keepRecord: true }).catch(() => undefined)
}
