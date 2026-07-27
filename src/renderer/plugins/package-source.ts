import { Capacitor } from '@capacitor/core'
import { isPrivateNetworkHost } from '@shared/plugins/network-policy'
import { PLUGIN_PACKAGE_LIMITS } from '@shared/plugins/package'
import { parsePluginMarketplaceCatalog, type PluginMarketplaceEntry } from '@shared/plugins/marketplace'
import { sha256Hex } from '@shared/skills/skillhub'
import {
  readCompletedDownload,
  yachiyoDownloadsNative,
  type NativeDownloadTask,
} from '@/platform/native/yachiyo_downloads'
import { markPendingPluginInstallEnqueued } from './pending-install'

export const DEFAULT_PLUGIN_MARKETPLACE_URL =
  'https://raw.githubusercontent.com/Wayne1145/yachiyo-claw/main/plugin-marketplace/index.json'
const MAX_PACKAGE_BYTES = PLUGIN_PACKAGE_LIMITS.maxArchiveBytes
const MAX_CATALOG_BYTES = 512 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

export interface ResolvedPluginPackage {
  url: string
  size: number
  sha256?: string
}

export interface PluginPackageDownloadRequest {
  id: string
  kind: 'plugin'
  title: string
  url: string
  expectedSize: number
  expectedSha256?: string
}

function requirePublicHttps(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('plugin_url_must_be_public_https')
  if (isPrivateNetworkHost(url.hostname)) throw new Error('plugin_url_private_network_denied')
  return url
}

function boundedSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_BYTES)
    throw new Error('plugin_package_size_invalid')
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
    if (!location) throw new Error('plugin_redirect_location_unavailable')
    current = requirePublicHttps(new URL(location, current).toString()).toString()
  }
  throw new Error('plugin_too_many_redirects')
}

async function probePackageSize(url: string, fetchImpl: typeof fetch): Promise<number> {
  if (Capacitor.isNativePlatform()) {
    const result = await yachiyoDownloadsNative.probe({ url, maximumBytes: MAX_PACKAGE_BYTES })
    return boundedSize(result.size)
  }
  const head = await fetchPublicHttps(url, { method: 'HEAD' }, fetchImpl)
  const headLength = head.ok ? head.headers.get('content-length') : null
  if (headLength) return boundedSize(headLength)
  const range = await fetchPublicHttps(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, fetchImpl)
  if (!range.ok) throw new Error(`plugin_package_probe_http_${range.status}`)
  if (range.url) requirePublicHttps(range.url)
  const match = range.headers.get('content-range')?.match(/\/(\d+)$/)
  const size = match?.[1] ?? (range.status === 200 ? range.headers.get('content-length') : null)
  await range.body?.cancel().catch(() => {})
  return boundedSize(size)
}

/** Accepts a direct HTTPS package URL or a GitHub repository/release page. */
/** 支持直接 HTTPS 安装包地址，以及 GitHub 仓库或 Release 页面。 */
export async function resolvePluginPackageSource(
  input: string,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedPluginPackage> {
  const url = requirePublicHttps(input.trim())
  const parts = url.pathname.split('/').filter(Boolean)
  if (
    url.hostname.toLowerCase() === 'github.com' &&
    parts.length >= 2 &&
    (parts.length === 2 || parts.slice(2).join('/') === 'releases/latest')
  ) {
    const [owner, repository] = parts
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository))
      throw new Error('github_repository_invalid')
    const metadata = await fetchPublicHttps(
      `https://api.github.com/repos/${owner}/${repository}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json' },
      },
      fetchImpl
    )
    if (!metadata.ok) throw new Error(`github_release_http_${metadata.status}`)
    const payload = (await metadata.json()) as {
      assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown }>
    }
    const assets = Array.isArray(payload.assets) ? payload.assets : []
    const asset =
      assets.find((item) => item.name === 'yachiyo-plugin.zip') ??
      assets.find((item) => typeof item.name === 'string' && item.name.endsWith('.zip'))
    if (!asset || typeof asset.browser_download_url !== 'string') throw new Error('github_release_plugin_asset_missing')
    const packageUrl = requirePublicHttps(asset.browser_download_url).toString()
    const digest =
      typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
        ? asset.digest.slice(7).toLowerCase()
        : undefined
    return { url: packageUrl, size: boundedSize(asset.size), sha256: digest }
  }
  return { url: url.toString(), size: await probePackageSize(url.toString(), fetchImpl) }
}

async function readResponseBounded(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`plugin_download_http_${response.status}`)
  if (response.url) requirePublicHttps(response.url)
  const declared = response.headers.get('content-length')
  if (declared) boundedSize(declared)
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('plugin_package_too_large')
    return bytes
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_PACKAGE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('plugin_package_too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function waitForNativeDownload(id: string): Promise<NativeDownloadTask> {
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    const task = (await yachiyoDownloadsNative.list()).tasks.find((entry) => entry.id === id)
    if (task?.status === 'completed') return task
    if (task?.status === 'failed' || task?.status === 'cancelled' || task?.status === 'paused') {
      throw new Error(task.error || `plugin_download_${task.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('plugin_download_wait_timeout')
}

/** Uses the persistent unified Android downloader; browser builds retain a bounded HTTPS fallback. */
/** Android 使用可持久化统一下载器，浏览器版本保留受限 HTTPS 兜底。 */
export async function downloadPluginPackage(
  source: ResolvedPluginPackage,
  title: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ bytes: Uint8Array; downloadId?: string; cleanup: () => Promise<void> }> {
  requirePublicHttps(source.url)
  const size = boundedSize(source.size)
  if (Capacitor.isNativePlatform()) {
    const request = await pluginPackageDownloadRequest(source, title)
    await yachiyoDownloadsNative.enqueue(request)
    markPendingPluginInstallEnqueued(request.id)
    await waitForNativeDownload(request.id)
    const bytes = await readCompletedDownload(request.id)
    // The installer no longer needs the package bytes after verification, but the completed row
    // 校验后安装器不再需要安装包字节，但完成记录仍应保留在下载历史中。
    // remains useful in the unified download history.
    return {
      bytes,
      downloadId: request.id,
      cleanup: () => yachiyoDownloadsNative.removeArtifact({ id: request.id, keepRecord: true }),
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const bytes = await readResponseBounded(
      await fetchPublicHttps(source.url, { signal: controller.signal }, fetchImpl)
    )
    if (bytes.byteLength !== size) throw new Error('plugin_package_size_mismatch')
    if (source.sha256 && (await sha256Hex(bytes)) !== source.sha256.toLowerCase())
      throw new Error('plugin_package_digest_mismatch')
    return { bytes, cleanup: async () => {} }
  } finally {
    clearTimeout(timer)
  }
}

export async function loadPluginMarketplace(
  url = DEFAULT_PLUGIN_MARKETPLACE_URL,
  fetchImpl: typeof fetch = fetch
): Promise<PluginMarketplaceEntry[]> {
  const target = requirePublicHttps(url).toString()
  const response = await fetchPublicHttps(target, { headers: { Accept: 'application/json' } }, fetchImpl)
  if (!response.ok) throw new Error(`plugin_marketplace_http_${response.status}`)
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_CATALOG_BYTES) throw new Error('plugin_marketplace_too_large')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) throw new Error('plugin_marketplace_too_large')
  return parsePluginMarketplaceCatalog(JSON.parse(text)).plugins
}

export function marketplacePackage(entry: PluginMarketplaceEntry): ResolvedPluginPackage {
  return { url: entry.packageUrl, size: entry.packageSize, sha256: entry.sha256 }
}

/** Stable request identity lets a killed WebView re-enqueue the same native transfer safely. */
/** 稳定请求标识让被终止的 WebView 可以安全地重新入队同一原生下载任务。 */
export async function pluginPackageDownloadRequest(
  source: ResolvedPluginPackage,
  title: string,
): Promise<PluginPackageDownloadRequest> {
  const url = requirePublicHttps(source.url).toString()
  const expectedSize = boundedSize(source.size)
  const identity = await sha256Hex(new TextEncoder().encode(`${url}\n${source.sha256 ?? ''}`))
  return {
    id: `plugin-${identity.slice(0, 32)}`,
    kind: 'plugin',
    title,
    url,
    expectedSize,
    ...(source.sha256 ? { expectedSha256: source.sha256.toLowerCase() } : {}),
  }
}
