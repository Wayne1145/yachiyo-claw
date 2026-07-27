import { validateRequestUrl } from '@shared/plugins/network-policy'

/**
 * Host-side fetch proxy for plugin egress (platform-22).
 *
 * The opaque Worker CSP denies ambient egress, so this proxy is the plugin's only network path.
 * Every hop of a redirect chain is validated (redirect: 'manual'); automatic following would let an
 * allowed host bounce the request off-list. After any redirect the request degrades to a bodyless GET
 * so a plugin body can never be re-sent to an unexpected host. Methods and request headers are
 * whitelisted; request/response sizes and total time are bounded. Only pure data is returned.
 */

export const PLUGIN_FETCH_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxUrlChars: 8 * 1024,
  maxHeaderBytes: 32 * 1024,
  maxResponseBytes: 512 * 1024,
  timeoutMs: 15_000,
  maxHops: 5,
  maxRequestsPerMinute: 30,
  maxResponseBytesPerHour: 10 * 1024 * 1024,
} as const

/** Per-plugin rolling quota. One instance must be owned by one plugin identity. */
export class PluginNetworkQuota {
  private requestTimes: number[] = []
  private responseBytes: Array<{ at: number; bytes: number }> = []

  beforeRequest(now = Date.now()): void {
    this.requestTimes = this.requestTimes.filter((at) => now - at < 60_000)
    this.responseBytes = this.responseBytes.filter((entry) => now - entry.at < 60 * 60_000)
    if (this.requestTimes.length >= PLUGIN_FETCH_LIMITS.maxRequestsPerMinute)
      throw new Error('network_rate_limit_exceeded')
    if (
      this.responseBytes.reduce((total, entry) => total + entry.bytes, 0) >= PLUGIN_FETCH_LIMITS.maxResponseBytesPerHour
    ) {
      throw new Error('network_byte_quota_exceeded')
    }
    this.requestTimes.push(now)
  }

  recordResponse(bytes: number, now = Date.now()): void {
    this.responseBytes = this.responseBytes.filter((entry) => now - entry.at < 60 * 60_000)
    const used = this.responseBytes.reduce((total, entry) => total + entry.bytes, 0)
    this.responseBytes.push({ at: now, bytes })
    if (used + bytes > PLUGIN_FETCH_LIMITS.maxResponseBytesPerHour) throw new Error('network_byte_quota_exceeded')
  }
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD'])
// Values come from the plugin itself (e.g. its own API key from its own storage); the host never
// injects credentials here.
const ALLOWED_REQUEST_HEADERS = new Set(['content-type', 'accept', 'authorization', 'x-api-key'])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface PluginFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PluginFetchResponse {
  status: number
  contentType: string
  body: string
  truncated: boolean
  finalUrl: string
}

async function readBodyBounded(response: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const view = new Uint8Array(await response.arrayBuffer())
    return { body: new TextDecoder().decode(view.slice(0, maxBytes)), truncated: view.byteLength > maxBytes }
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.slice(0, maxBytes - size))
      size = maxBytes
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { body: new TextDecoder().decode(merged), truncated }
}

export async function pluginFetch(
  request: PluginFetchRequest,
  allowedDomains: readonly string[],
  fetchImpl: typeof fetch = fetch,
  quota?: PluginNetworkQuota,
  options: { signal?: AbortSignal } = {}
): Promise<PluginFetchResponse> {
  if (allowedDomains.length === 0) throw new Error('egress_denied:no_domains_granted')
  if (request.url.length > PLUGIN_FETCH_LIMITS.maxUrlChars) throw new Error('url_too_large')
  const method = (request.method ?? 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) throw new Error('method_not_allowed')
  if (request.body !== undefined && typeof request.body !== 'string') throw new Error('body_must_be_string')
  if (request.body && new TextEncoder().encode(request.body).byteLength > PLUGIN_FETCH_LIMITS.maxBodyBytes) {
    throw new Error('body_too_large')
  }
  quota?.beforeRequest()
  const headers: Record<string, string> = {}
  let headerBytes = 0
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (typeof value !== 'string') continue
    const normalized = name.toLowerCase()
    if (!ALLOWED_REQUEST_HEADERS.has(normalized)) continue
    if (/\r|\n/.test(value)) throw new Error('header_value_invalid')
    headerBytes += new TextEncoder().encode(`${normalized}:${value}`).byteLength
    if (headerBytes > PLUGIN_FETCH_LIMITS.maxHeaderBytes) throw new Error('headers_too_large')
    headers[normalized] = value
  }

  let url = request.url
  for (let hop = 0; hop <= PLUGIN_FETCH_LIMITS.maxHops; hop++) {
    if (options.signal?.aborted) throw new Error('fetch_cancelled')
    if (url.length > PLUGIN_FETCH_LIMITS.maxUrlChars) throw new Error('url_too_large')
    const decision = validateRequestUrl(url, allowedDomains)
    if (!decision.ok) throw new Error(`egress_denied:${decision.reason}`)

    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), PLUGIN_FETCH_LIMITS.timeoutMs)
    let phase: 'fetch' | 'response' = 'fetch'
    try {
      const response = await fetchImpl(url, {
        method: hop === 0 ? method : 'GET',
        headers: hop === 0 ? headers : {},
        body: hop === 0 ? request.body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      })
      phase = 'response'
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error('redirect_without_location')
        url = new URL(location, url).toString()
        continue
      }

      const { body, truncated } = await readBodyBounded(response, PLUGIN_FETCH_LIMITS.maxResponseBytes)
      quota?.recordResponse(new TextEncoder().encode(body).byteLength)
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body,
        truncated,
        finalUrl: url,
      }
    } catch (error) {
      const cancelled = options.signal?.aborted
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(cancelled ? 'fetch_cancelled' : 'fetch_timeout')
      }
      if (phase === 'fetch') throw new Error('fetch_failed')
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }
  throw new Error('too_many_redirects')
}
