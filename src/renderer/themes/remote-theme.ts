import { Capacitor } from '@capacitor/core'
import { isPrivateNetworkHost } from '@shared/plugins/network-policy'
import { sha256Hex } from '@shared/skills/skillhub'
import { MAX_THEME_MANIFEST_BYTES } from '@shared/themes/theme'
import {
  readCompletedDownload,
  yachiyoDownloadsNative,
  type NativeDownloadTask,
} from '@/platform/native/yachiyo_downloads'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const PENDING_THEME_KEY = 'yachiyo:themes:pending-download:v1'
const RECOVERED_THEME_KEY = 'yachiyo:themes:recovered-draft:v1'

function requirePublicHttps(input: string): URL {
  const url = new URL(input.trim())
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('theme_url_must_be_public_https')
  if (isPrivateNetworkHost(url.hostname)) throw new Error('theme_url_private_network_denied')
  return url
}

function boundedSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_THEME_MANIFEST_BYTES)
    throw new Error('theme_manifest_size_invalid')
  return size
}

async function fetchPublicHttps(input: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let current = requirePublicHttps(input).toString()
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current, { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (response.url) requirePublicHttps(response.url)
      return response
    }
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) throw new Error('theme_redirect_location_unavailable')
    current = requirePublicHttps(new URL(location, current).toString()).toString()
  }
  throw new Error('theme_too_many_redirects')
}

async function probeThemeSize(url: string, fetchImpl: typeof fetch): Promise<number> {
  if (Capacitor.isNativePlatform()) {
    const result = await yachiyoDownloadsNative.probe({ url, maximumBytes: MAX_THEME_MANIFEST_BYTES })
    return boundedSize(result.size)
  }
  const head = await fetchPublicHttps(url, { method: 'HEAD' }, fetchImpl)
  const declared = head.ok ? head.headers.get('content-length') : null
  await head.body?.cancel().catch(() => undefined)
  if (declared) return boundedSize(declared)

  const range = await fetchPublicHttps(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, fetchImpl)
  if (!range.ok) throw new Error(`theme_probe_http_${range.status}`)
  const match = range.headers.get('content-range')?.match(/\/(\d+)$/)
  const size = match?.[1] ?? (range.status === 200 ? range.headers.get('content-length') : null)
  await range.body?.cancel().catch(() => undefined)
  return boundedSize(size)
}

async function waitForNativeDownload(id: string): Promise<NativeDownloadTask> {
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const task = (await yachiyoDownloadsNative.list()).tasks.find((entry) => entry.id === id)
    if (task?.status === 'completed') return task
    if (task?.status === 'failed' || task?.status === 'cancelled' || task?.status === 'paused') {
      throw new Error(task.error || `theme_download_${task.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('theme_download_wait_timeout')
}

interface PendingThemeImport {
  schemaVersion: 1
  state: 'prepared' | 'enqueued'
  request: {
    id: string
    kind: 'theme'
    title: string
    url: string
    expectedSize: number
  }
  createdAt: number
}

function readPendingThemeImport(): PendingThemeImport | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_THEME_KEY) || 'null') as Partial<PendingThemeImport> | null
    const request = value?.request
    if (
      value?.schemaVersion !== 1 ||
      (value.state !== 'prepared' && value.state !== 'enqueued') ||
      !Number.isSafeInteger(value.createdAt) ||
      Date.now() - Number(value.createdAt) > 7 * 24 * 60 * 60_000 ||
      !request ||
      !/^theme-[a-f0-9]{32}$/.test(request.id) ||
      request.kind !== 'theme' ||
      typeof request.url !== 'string' ||
      !Number.isSafeInteger(request.expectedSize) ||
      request.expectedSize <= 0 ||
      request.expectedSize > MAX_THEME_MANIFEST_BYTES
    ) {
      localStorage.removeItem(PENDING_THEME_KEY)
      return null
    }
    return value as PendingThemeImport
  } catch {
    return null
  }
}

function savePendingThemeImport(value: PendingThemeImport): void {
  localStorage.setItem(PENDING_THEME_KEY, JSON.stringify(value))
}

function clearPendingThemeImport(id: string): void {
  const pending = readPendingThemeImport()
  if (!pending || pending.request.id === id) localStorage.removeItem(PENDING_THEME_KEY)
}

async function readAndReleaseTheme(id: string): Promise<string> {
  const bytes = await readCompletedDownload(id)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  await yachiyoDownloadsNative.removeArtifact({ id, keepRecord: true })
  clearPendingThemeImport(id)
  return text
}

async function readResponseBounded(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`theme_download_http_${response.status}`)
  if (response.url) requirePublicHttps(response.url)
  const declared = response.headers.get('content-length')
  if (declared) boundedSize(declared)
  const bytes = new Uint8Array(await response.arrayBuffer())
  boundedSize(bytes.byteLength)
  return bytes
}

/** Downloads a declarative theme through Android's persistent downloader and returns UTF-8 JSON. */
export async function downloadRemoteTheme(input: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = requirePublicHttps(input).toString()
  const size = await probeThemeSize(url, fetchImpl)

  if (Capacitor.isNativePlatform()) {
    const identity = await sha256Hex(new TextEncoder().encode(url))
    const id = `theme-${identity.slice(0, 32)}`
    const request = {
      id,
      kind: 'theme' as const,
      title: '主题清单',
      url,
      expectedSize: size,
    }
    savePendingThemeImport({ schemaVersion: 1, state: 'prepared', request, createdAt: Date.now() })
    await yachiyoDownloadsNative.enqueue(request)
    savePendingThemeImport({ schemaVersion: 1, state: 'enqueued', request, createdAt: Date.now() })
    await waitForNativeDownload(id)
    return readAndReleaseTheme(id)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const bytes = await readResponseBounded(
      await fetchPublicHttps(url, { signal: controller.signal }, fetchImpl),
    )
    if (bytes.byteLength !== size) throw new Error('theme_manifest_size_mismatch')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    clearTimeout(timer)
  }
}

export async function resumePendingThemeImport(): Promise<'none' | 'waiting' | 'restored' | 'failed'> {
  if (!Capacitor.isNativePlatform()) return 'none'
  const pending = readPendingThemeImport()
  if (!pending) return 'none'
  const task = (await yachiyoDownloadsNative.list()).tasks.find((entry) => entry.id === pending.request.id)
  if (!task) {
    if (pending.state === 'enqueued') {
      clearPendingThemeImport(pending.request.id)
      return 'failed'
    }
    await yachiyoDownloadsNative.enqueue(pending.request)
    savePendingThemeImport({ ...pending, state: 'enqueued' })
    return 'waiting'
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    clearPendingThemeImport(pending.request.id)
    return 'failed'
  }
  if (task.status !== 'completed') return 'waiting'
  const text = await readAndReleaseTheme(pending.request.id)
  localStorage.setItem(RECOVERED_THEME_KEY, text)
  return 'restored'
}

export function consumeRecoveredThemeImport(): string | null {
  const text = localStorage.getItem(RECOVERED_THEME_KEY)
  if (text !== null) localStorage.removeItem(RECOVERED_THEME_KEY)
  return text
}

let recoveryTimer: number | undefined
export function startPendingThemeImportRecovery(onRestored: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      if ((await resumePendingThemeImport()) === 'restored') {
        if (recoveryTimer !== undefined) window.clearInterval(recoveryTimer)
        recoveryTimer = undefined
        onRestored()
      }
    } finally {
      running = false
    }
  }
  void run().catch(() => undefined)
  recoveryTimer ??= window.setInterval(() => void run().catch(() => undefined), 2_000)
  return () => {
    if (recoveryTimer !== undefined) window.clearInterval(recoveryTimer)
    recoveryTimer = undefined
  }
}
