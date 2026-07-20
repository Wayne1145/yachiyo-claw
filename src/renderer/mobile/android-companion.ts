/**
 * Small, model-agnostic bridge for optional Android companion processes.
 *
 * The companion is deliberately narrower than MCP itself: callers can invoke
 * only the canonical Android controls below.  A companion's tool catalogue or
 * JSON schema is never returned from this module, so it cannot silently expand
 * the model-facing tool surface.  The native Broker remains the authority for
 * privileged execution; this module only transports canonical requests.
 */

export const ANDROID_COMPANION_PROTOCOLS = ['yachiyo-http', 'android-remote-control', 'generic-mcp-http'] as const
export type AndroidCompanionProtocol = (typeof ANDROID_COMPANION_PROTOCOLS)[number]

export const ANDROID_CANONICAL_CAPABILITIES = [
  'observe',
  'find',
  'click',
  'setText',
  'scroll',
  'launch',
  'verify',
] as const
export type AndroidCanonicalCapability = (typeof ANDROID_CANONICAL_CAPABILITIES)[number]
export type AndroidCapability = AndroidCanonicalCapability
export interface CanonicalAndroidAction {
  capability: AndroidCanonicalCapability
  parameters: AndroidControlParameters
}
export type CanonicalActionResult = AndroidControlResult
export type SemanticSnapshot = unknown

export const MAX_COMPANION_RESPONSE_BYTES = 8 * 1024
/** Backward-friendly alias for callers that use the Android terminology. */
export const ANDROID_COMPANION_MAX_RESPONSE_BYTES = MAX_COMPANION_RESPONSE_BYTES
export const DEFAULT_COMPANION_TIMEOUT_MS = 10_000

const CAPABILITY_SET = new Set<string>(ANDROID_CANONICAL_CAPABILITIES)
const PROTOCOL_SET = new Set<string>(ANDROID_COMPANION_PROTOCOLS)

export type AndroidCompanionJson =
  | null
  | boolean
  | number
  | string
  | AndroidCompanionJson[]
  | { [key: string]: AndroidCompanionJson }

export interface AndroidNodeSelector {
  packageName?: string
  resourceId?: string
  text?: string
  contentDescription?: string
  role?: string
  ancestorSignature?: string
}

export interface AndroidObserveRequest {
  packageName?: string
}

export interface AndroidFindRequest {
  selector: AndroidNodeSelector
}

export interface AndroidClickRequest {
  selector: AndroidNodeSelector
}

export interface AndroidSetTextRequest {
  selector: AndroidNodeSelector
  text: string
}

export type AndroidScrollDirection = 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward'

export interface AndroidScrollRequest {
  selector: AndroidNodeSelector
  direction: AndroidScrollDirection
}

export interface AndroidLaunchRequest {
  packageName: string
  activityName?: string
}

export interface AndroidVerifyRequest {
  expected?: AndroidCompanionJson
  selector?: AndroidNodeSelector
  packageName?: string
}

/**
 * Structured parameters supplied by the canonical Android controls.
 *
 * Keep this as `object` instead of `Record<string, unknown>`: TypeScript
 * interfaces such as `AndroidFindRequest` are valid structured objects but do
 * not implicitly acquire an index signature.  Values are narrowed to the
 * recursive JSON type immediately before transport by `jsonSafe`.
 */
export type AndroidControlParameters = object

export interface AndroidCompanionConnectionPolicy {
  /** Exact hosts, host:port values, URLs, or IPv4 CIDR ranges allowed over HTTP. */
  allowedTunAddresses?: readonly string[]
  /** Alias accepted by integrations that call these entries tunAddresses. */
  tunAddresses?: readonly string[]
}

export type CompanionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface AndroidControlAdapterOptions {
  id?: string
  name?: string
  protocol?: AndroidCompanionProtocol
  /** `kind` is accepted as an integration-friendly alias for protocol. */
  kind?: AndroidCompanionProtocol
  /** The full companion call endpoint. */
  url?: string
  endpoint?: string
  baseUrl?: string
  connectionPolicy?: AndroidCompanionConnectionPolicy
  allowedTunAddresses?: readonly string[]
  tunAddresses?: readonly string[]
  timeoutMs?: number
  fetch?: CompanionFetch
  fetchImpl?: CompanionFetch
  /** Ephemeral headers resolved from the mobile secure vault at startup. */
  defaultHeaders?: Record<string, string>
  defaultBearerToken?: string
  capabilities?: readonly AndroidCanonicalCapability[]
  /** Optional fixed path or per-capability paths for REST-style companions. */
  requestPath?: string
  paths?: Partial<Record<AndroidCanonicalCapability, string>>
  /** Disable this adapter after a transport/protocol/HTTP failure (default true). */
  disableOnFailure?: boolean
}

export interface AndroidControlCallOptions {
  /** The caller owns the token lifetime; the adapter never persists it. */
  token?: string
  /** Alias for callers that name the value bearerToken. */
  bearerToken?: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Additional non-auth headers. Authorization is always derived from token. */
  headers?: Record<string, string>
  requestId?: string
}

export interface AndroidCompanionError {
  code: string
  message: string
  retryable: boolean
}

export interface AndroidNativeFallbackSignal {
  type: 'android-companion-fallback'
  companionId: string
  capability?: AndroidCanonicalCapability
  reason: string
  errorCode?: string
  at: number
}

export type CompanionFallbackSignal = AndroidNativeFallbackSignal
export type NativeFallbackSignal = AndroidNativeFallbackSignal

export interface AndroidControlResult {
  companionId: string
  protocol: AndroidCompanionProtocol
  capability: AndroidCanonicalCapability
  /** `success` and `ok` are intentionally canonical and protocol-independent. */
  success: boolean
  ok: boolean
  data?: unknown
  error?: AndroidCompanionError
  statusCode?: number
  responseBytes: number
  truncated: boolean
  /** The caller should invoke the native Broker when this is true. */
  fallbackToNative: boolean
  disabled: boolean
  fallbackSignal?: AndroidNativeFallbackSignal
}

export interface AndroidCompanionDispatchOptions extends AndroidControlCallOptions {
  companionId?: string
  adapterId?: string
}

export class AndroidCompanionConfigurationError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'AndroidCompanionConfigurationError'
    this.code = code
  }
}

/** Return a URL with credentials and unsupported schemes rejected. */
export function validateCompanionUrl(
  value: string,
  policy: AndroidCompanionConnectionPolicy = {}
): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AndroidCompanionConfigurationError('companion_url_invalid')
  }

  if (url.username || url.password) {
    throw new AndroidCompanionConfigurationError('companion_url_credentials_forbidden')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AndroidCompanionConfigurationError('companion_url_scheme_forbidden')
  }

  const host = normalizeHost(url.hostname)
  const loopback = isLoopbackHost(host)
  const allowedTun = matchesAllowedAddress(host, url.port, [
    ...(policy.allowedTunAddresses || []),
    ...(policy.tunAddresses || []),
  ])

  // HTTPS is safe as a transport boundary.  Plain HTTP is restricted to the
  // local device or an explicitly supplied TUN address.
  if (url.protocol === 'http:' && !loopback && !allowedTun) {
    throw new AndroidCompanionConfigurationError('companion_http_host_not_allowed')
  }
  return url
}

export function isAllowedCompanionUrl(value: string, policy: AndroidCompanionConnectionPolicy = {}): boolean {
  try {
    validateCompanionUrl(value, policy)
    return true
  } catch {
    return false
  }
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === 'localhost.localdomain' || host === '::1') return true
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const first = Number(parts[0])
  return first === 127 && parts.every((part) => Number(part) >= 0 && Number(part) <= 255)
}

function parseAddressEntry(value: string): { host: string; port?: string; cidr?: number } | null {
  const candidate = value.trim()
  if (!candidate) return null

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate)
      return { host: normalizeHost(parsed.hostname), port: parsed.port || undefined }
    } catch {
      return null
    }
  }

  const cidrMatch = candidate.match(/^([^/]+)\/(\d{1,2})$/)
  if (cidrMatch) {
    const cidr = Number(cidrMatch[2])
    if (cidr <= 32 && isIpv4(cidrMatch[1])) return { host: normalizeHost(cidrMatch[1]), cidr }
    return null
  }

  // Bracketed IPv6 may include a port; unbracketed IPv6 is treated as a host.
  if (candidate.startsWith('[')) {
    const end = candidate.indexOf(']')
    if (end >= 0) {
      return { host: normalizeHost(candidate.slice(0, end + 1)), port: candidate.slice(end + 1).replace(/^:/, '') || undefined }
    }
  }

  const hostPort = candidate.match(/^([^:]+):(\d+)$/)
  if (hostPort) return { host: normalizeHost(hostPort[1]), port: hostPort[2] }
  return { host: normalizeHost(candidate) }
}

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

function ipv4Number(value: string): number {
  return value.split('.').reduce((result, part) => result * 256 + Number(part), 0) >>> 0
}

function matchesAllowedAddress(host: string, port: string, entries: readonly string[]): boolean {
  for (const rawEntry of entries) {
    const entry = parseAddressEntry(rawEntry)
    if (!entry) continue
    if (entry.port && entry.port !== port) continue
    if (entry.cidr !== undefined && isIpv4(host) && isIpv4(entry.host)) {
      const mask = entry.cidr === 0 ? 0 : (0xffffffff << (32 - entry.cidr)) >>> 0
      if ((ipv4Number(host) & mask) === (ipv4Number(entry.host) & mask)) return true
      continue
    }
    if (entry.host === host) return true
  }
  return false
}

function normalizeProtocol(value: AndroidCompanionProtocol | undefined): AndroidCompanionProtocol {
  if (value && PROTOCOL_SET.has(value)) return value
  throw new AndroidCompanionConfigurationError('companion_protocol_unsupported')
}

function normalizeCapabilities(value: readonly AndroidCanonicalCapability[] | undefined): ReadonlySet<AndroidCanonicalCapability> {
  const capabilities = value || ANDROID_CANONICAL_CAPABILITIES
  const normalized = new Set<AndroidCanonicalCapability>()
  for (const capability of capabilities) {
    if (!CAPABILITY_SET.has(capability)) {
      throw new AndroidCompanionConfigurationError('companion_capability_unsupported')
    }
    normalized.add(capability)
  }
  return normalized
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_COMPANION_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) {
    throw new AndroidCompanionConfigurationError('companion_timeout_invalid')
  }
  return Math.min(Math.floor(value), 120_000)
}

function createRequestId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch {
    // Fall through to a non-sensitive local identifier.
  }
  return `companion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toMcpToolName(capability: AndroidCanonicalCapability): string {
  return `android_${capability.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`
}

export function mapCompanionCapability(
  protocol: AndroidCompanionProtocol,
  capability: AndroidCanonicalCapability
): string {
  normalizeProtocol(protocol)
  if (!CAPABILITY_SET.has(capability)) throw new AndroidCompanionConfigurationError('companion_capability_unsupported')
  return protocol === 'generic-mcp-http' ? toMcpToolName(capability) : capability
}

function joinEndpoint(base: URL, path: string | undefined): string {
  if (!path) return base.toString()
  let joined: URL
  try {
    joined = new URL(path, base)
  } catch {
    throw new AndroidCompanionConfigurationError('companion_request_path_invalid')
  }

  // Capability paths are routing hints, not a second network policy.  Keep
  // them on the already validated companion origin so a malformed or remote
  // path cannot turn the adapter into an SSRF proxy.
  if (
    joined.origin !== base.origin ||
    joined.protocol !== base.protocol ||
    joined.username ||
    joined.password
  ) {
    throw new AndroidCompanionConfigurationError('companion_request_path_origin_forbidden')
  }
  return joined.toString()
}

function jsonSafe(value: unknown): AndroidCompanionJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AndroidCompanionConfigurationError('companion_parameters_invalid')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item))
  if (typeof value === 'object') {
    const result: { [key: string]: AndroidCompanionJson } = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      result[key] = jsonSafe(item)
    }
    return result
  }
  throw new AndroidCompanionConfigurationError('companion_parameters_invalid')
}

function clipUtf8(value: string, maxBytes = MAX_COMPANION_RESPONSE_BYTES): { text: string; bytes: number; truncated: boolean } {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return { text: value, bytes: encoded.byteLength, truncated: false }
  const clipped = encoded.slice(0, maxBytes)
  return { text: new TextDecoder().decode(clipped), bytes: clipped.byteLength, truncated: true }
}

async function readBoundedResponse(response: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return clipUtf8(await response.text().catch(() => ''))

  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  try {
    while (size < MAX_COMPANION_RESPONSE_BYTES) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value)
      const remaining = MAX_COMPANION_RESPONSE_BYTES - size
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.slice(0, remaining))
        size += remaining
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(chunk)
      size += chunk.byteLength
    }
  } finally {
    reader.releaseLock?.()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(bytes), bytes: size, truncated }
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function extractMcpResult(value: unknown): { success: boolean; data?: unknown; error?: AndroidCompanionError } {
  const root = asRecord(value)
  if (!root) return { success: true, data: value }
  if (root.error !== undefined) {
    const error = asRecord(root.error)
    return {
      success: false,
      error: {
        code: stringValue(error?.code) || 'companion_mcp_error',
        message: stringValue(error?.message) || 'MCP companion returned an error',
        retryable: true,
      },
    }
  }
  const result = asRecord(root.result) || root
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : []
    const message = content
      .map((part) => stringValue(asRecord(part)?.text))
      .filter((part): part is string => Boolean(part))
      .join('\n')
    return {
      success: false,
      error: { code: 'companion_mcp_tool_error', message: message || 'MCP companion tool failed', retryable: true },
    }
  }
  if (result.structuredContent !== undefined) return { success: true, data: result.structuredContent }
  if (result.content !== undefined) {
    const content = Array.isArray(result.content) ? result.content : [result.content]
    const textParts = content
      .map((part) => stringValue(asRecord(part)?.text))
      .filter((part): part is string => Boolean(part))
    if (textParts.length === 1) return { success: true, data: parseJson(textParts[0]) }
    if (textParts.length > 1) return { success: true, data: textParts.join('\n') }
  }
  return { success: true, data: result.data ?? result.output ?? result }
}

function extractHttpResult(value: unknown): { success: boolean; data?: unknown; error?: AndroidCompanionError } {
  const root = asRecord(value)
  if (!root) return { success: true, data: value }
  if (root.error !== undefined || root.ok === false || root.success === false) {
    const error = asRecord(root.error)
    return {
      success: false,
      error: {
        code: stringValue(error?.code) || stringValue(root.code) || 'companion_action_failed',
        message:
          stringValue(error?.message) || stringValue(root.message) || stringValue(root.reason) || 'Companion action failed',
        retryable: root.retryable !== false,
      },
    }
  }
  return { success: true, data: root.data ?? root.output ?? root.result ?? root }
}

function errorResult(
  adapter: AndroidControlAdapter,
  capability: AndroidCanonicalCapability,
  error: AndroidCompanionError,
  options: { statusCode?: number; responseBytes?: number; truncated?: boolean; fallbackSignal?: AndroidNativeFallbackSignal } = {}
): AndroidControlResult {
  return {
    companionId: adapter.id,
    protocol: adapter.protocol,
    capability,
    success: false,
    ok: false,
    error,
    ...(options.statusCode === undefined ? {} : { statusCode: options.statusCode }),
    responseBytes: options.responseBytes || 0,
    truncated: options.truncated === true,
    fallbackToNative: true,
    disabled: adapter.isDisabled(),
    ...(options.fallbackSignal ? { fallbackSignal: options.fallbackSignal } : {}),
  }
}

export class AndroidControlAdapter {
  readonly id: string
  readonly name: string
  readonly protocol: AndroidCompanionProtocol
  readonly url: string
  readonly capabilities: ReadonlySet<AndroidCanonicalCapability>

  private readonly endpoint: URL
  private readonly fetchImpl: CompanionFetch
  private readonly timeoutMs: number
  private readonly requestPath?: string
  private readonly paths: Partial<Record<AndroidCanonicalCapability, string>>
  private readonly disableOnFailure: boolean
  private readonly defaultHeaders: Record<string, string>
  private readonly defaultBearerToken: string
  private disabledReason: string | undefined
  private readonly fallbackListeners = new Set<(signal: AndroidNativeFallbackSignal) => void>()

  constructor(options: AndroidControlAdapterOptions) {
    const protocol = normalizeProtocol(options.protocol || options.kind)
    const rawUrl = options.url || options.endpoint || options.baseUrl
    if (!rawUrl) throw new AndroidCompanionConfigurationError('companion_url_required')
    const policy = {
      ...(options.connectionPolicy || {}),
      allowedTunAddresses: [
        ...(options.connectionPolicy?.allowedTunAddresses || []),
        ...(options.allowedTunAddresses || []),
      ],
      tunAddresses: [...(options.connectionPolicy?.tunAddresses || []), ...(options.tunAddresses || [])],
    }
    const endpoint = validateCompanionUrl(rawUrl, policy)
    const fetchImpl = options.fetchImpl || options.fetch || globalThis.fetch?.bind(globalThis)
    if (!fetchImpl) throw new AndroidCompanionConfigurationError('companion_fetch_unavailable')

    this.id = options.id?.trim() || `android-companion-${protocol}`
    this.name = options.name?.trim() || this.id
    this.protocol = protocol
    this.endpoint = endpoint
    this.url = endpoint.toString()
    this.fetchImpl = fetchImpl
    this.timeoutMs = normalizeTimeout(options.timeoutMs)
    this.capabilities = normalizeCapabilities(options.capabilities)
    this.requestPath = options.requestPath
    this.paths = options.paths || {}
    this.disableOnFailure = options.disableOnFailure !== false
    this.defaultHeaders = { ...(options.defaultHeaders || {}) }
    this.defaultBearerToken = (options.defaultBearerToken || '').trim()
  }

  get disabled(): boolean {
    return this.disabledReason !== undefined
  }

  get failureReason(): string | undefined {
    return this.disabledReason
  }

  isDisabled(): boolean {
    return this.disabled
  }

  /** Optional lifecycle hook used by callers that perform an explicit handshake. */
  async connect(options: AndroidControlCallOptions = {}): Promise<void> {
    const result = await this.call('observe', {}, options)
    if (!result.success) throw new Error(result.error?.code || 'companion_connect_failed')
  }

  async execute(action: CanonicalAndroidAction, options: AndroidControlCallOptions = {}): Promise<CanonicalActionResult> {
    return this.call(action.capability, action.parameters, options)
  }

  async close(): Promise<void> {
    // HTTP companions are request-scoped and do not hold a socket in this layer.
  }

  supports(capability: AndroidCanonicalCapability): boolean {
    return this.capabilities.has(capability)
  }

  getCanonicalCapabilities(): readonly AndroidCanonicalCapability[] {
    return ANDROID_CANONICAL_CAPABILITIES.filter((capability) => this.capabilities.has(capability))
  }

  onNativeFallback(listener: (signal: AndroidNativeFallbackSignal) => void): () => void {
    this.fallbackListeners.add(listener)
    return () => this.fallbackListeners.delete(listener)
  }

  disable(reason = 'companion_disabled', capability?: AndroidCanonicalCapability): AndroidNativeFallbackSignal {
    this.disabledReason = reason.slice(0, 256)
    const signal: AndroidNativeFallbackSignal = {
      type: 'android-companion-fallback',
      companionId: this.id,
      ...(capability ? { capability } : {}),
      reason: this.disabledReason,
      at: Date.now(),
    }
    this.fallbackListeners.forEach((listener) => listener(signal))
    return signal
  }

  enable(): void {
    this.disabledReason = undefined
  }

  async call(
    capability: AndroidCanonicalCapability,
    parameters: AndroidControlParameters = {},
    options: AndroidControlCallOptions = {}
  ): Promise<AndroidControlResult> {
    if (!CAPABILITY_SET.has(capability)) {
      throw new AndroidCompanionConfigurationError('companion_capability_unsupported')
    }
    if (!this.supports(capability)) {
      return errorResult(this, capability, {
        code: 'companion_capability_unavailable',
        message: `Companion does not support ${capability}`,
        retryable: false,
      })
    }
    if (this.disabled) {
      return errorResult(this, capability, {
        code: 'companion_disabled',
        message: this.disabledReason || 'Companion is disabled',
        retryable: false,
      })
    }

    // An already-cancelled caller should never create a network request or
    // disable an otherwise healthy companion.
    if (options.signal?.aborted) {
      return errorResult(this, capability, {
        code: 'companion_aborted',
        message: 'Companion request aborted',
        retryable: false,
      })
    }

    const safeParameters = jsonSafe(parameters)
    const requestId = options.requestId || createRequestId()
    const path = this.paths[capability] || this.requestPath
    const request = this.buildRequest(capability, safeParameters, requestId, path)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    for (const [key, value] of Object.entries({ ...this.defaultHeaders, ...(options.headers || {}) })) {
      if (key.toLowerCase() === 'authorization') continue
      headers[key] = value
    }
    const token = (options.token || options.bearerToken || this.defaultBearerToken).trim()
    if (token) headers.Authorization = `Bearer ${token}`

    const controller = new AbortController()
    let timedOut = false
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.timeoutMs)
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const abortListener = () => controller.abort()
    options.signal?.addEventListener('abort', abortListener, { once: true })

    try {
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
        redirect: 'error',
      })
      const body = await readBoundedResponse(response)
      const status = typeof response.status === 'number' ? response.status : undefined
      const httpOk = response.ok === true || (response.ok === undefined && (status === undefined || (status >= 200 && status < 300)))
      if (!httpOk) {
        return this.failedResult(capability, {
          code: `companion_http_${status || 'error'}`,
          message: clipUtf8(body.text, 1_024).text || 'Companion HTTP request failed',
          retryable: status === undefined || status === 408 || status === 429 || status >= 500,
        }, body, status)
      }

      const parsed = parseJson(body.text)
      const normalized =
        this.protocol === 'generic-mcp-http' ? extractMcpResult(parsed) : extractHttpResult(parsed)
      if (!normalized.success) return this.failedResult(capability, normalized.error!, body, status)
      return {
        companionId: this.id,
        protocol: this.protocol,
        capability,
        success: true,
        ok: true,
        ...(normalized.data === undefined ? {} : { data: normalized.data }),
        ...(status === undefined ? {} : { statusCode: status }),
        responseBytes: body.bytes,
        truncated: body.truncated,
        fallbackToNative: false,
        disabled: this.disabled,
      }
    } catch (error) {
      const code = timedOut ? 'companion_timeout' : options.signal?.aborted ? 'companion_aborted' : 'companion_unreachable'
      const message = timedOut ? 'Companion request timed out' : code === 'companion_aborted' ? 'Companion request aborted' : 'Companion request failed'
      return this.failedResult(capability, { code, message, retryable: code !== 'companion_aborted' }, undefined, undefined, {
        disableAdapter: code !== 'companion_aborted',
      })
    } finally {
      clearTimeout(timeoutId)
      options.signal?.removeEventListener('abort', abortListener)
    }
  }

  observe(request: AndroidObserveRequest = {}, options?: AndroidControlCallOptions) {
    return this.call('observe', request, options)
  }

  find(request: AndroidFindRequest | AndroidNodeSelector, options?: AndroidControlCallOptions) {
    return this.call('find', 'selector' in request ? request : { selector: request }, options)
  }

  click(request: AndroidClickRequest | AndroidNodeSelector, options?: AndroidControlCallOptions) {
    return this.call('click', 'selector' in request ? request : { selector: request }, options)
  }

  setText(
    request: AndroidSetTextRequest | AndroidNodeSelector,
    text?: string,
    options?: AndroidControlCallOptions
  ) {
    return this.call('setText', 'selector' in request ? request : { selector: request, text: text || '' }, options)
  }

  scroll(
    request: AndroidScrollRequest | AndroidNodeSelector,
    direction?: AndroidScrollDirection,
    options?: AndroidControlCallOptions
  ) {
    return this.call(
      'scroll',
      'selector' in request ? request : { selector: request, direction: direction || 'forward' },
      options
    )
  }

  launch(request: AndroidLaunchRequest | string, options?: AndroidControlCallOptions) {
    return this.call('launch', typeof request === 'string' ? { packageName: request } : request, options)
  }

  verify(request: AndroidVerifyRequest = {}, options?: AndroidControlCallOptions) {
    return this.call('verify', request, options)
  }

  private buildRequest(
    capability: AndroidCanonicalCapability,
    parameters: AndroidCompanionJson,
    requestId: string,
    path?: string
  ): { url: string; body: AndroidCompanionJson } {
    const url = joinEndpoint(this.endpoint, path)
    if (this.protocol === 'generic-mcp-http') {
      return {
        url,
        body: {
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name: mapCompanionCapability(this.protocol, capability),
            arguments: parameters,
          },
        },
      }
    }
    if (this.protocol === 'android-remote-control') {
      return { url, body: { action: capability, parameters } }
    }
    return { url, body: { version: 1, requestId, capability, parameters } }
  }

  private failedResult(
    capability: AndroidCanonicalCapability,
    error: AndroidCompanionError,
    body?: { bytes: number; truncated: boolean },
    statusCode?: number,
    options: { disableAdapter?: boolean } = {}
  ): AndroidControlResult {
    const signal = this.disableOnFailure && options.disableAdapter !== false ? this.disable(error.message, capability) : undefined
    return errorResult(this, capability, error, {
      statusCode,
      responseBytes: body?.bytes,
      truncated: body?.truncated,
      fallbackSignal: signal,
    })
  }
}

export interface AndroidCompanionRegistryOptions {
  adapters?: Iterable<AndroidControlAdapter>
  onNativeFallback?: (signal: AndroidNativeFallbackSignal) => void
}

export class AndroidCompanionRegistry {
  private readonly adapters = new Map<string, AndroidControlAdapter>()
  private readonly subscriptions = new Map<string, () => void>()
  private readonly fallbackListeners = new Set<(signal: AndroidNativeFallbackSignal) => void>()
  private lastFallbackSignal: AndroidNativeFallbackSignal | null = null

  constructor(options: AndroidCompanionRegistryOptions = {}) {
    if (options.onNativeFallback) this.fallbackListeners.add(options.onNativeFallback)
    for (const adapter of options.adapters || []) this.register(adapter)
  }

  register(adapter: AndroidControlAdapter): AndroidControlAdapter
  register(options: AndroidControlAdapterOptions): AndroidControlAdapter
  register(input: AndroidControlAdapter | AndroidControlAdapterOptions): AndroidControlAdapter {
    const adapter = input instanceof AndroidControlAdapter ? input : new AndroidControlAdapter(input)
    if (this.adapters.has(adapter.id)) throw new AndroidCompanionConfigurationError('companion_id_duplicate')
    this.adapters.set(adapter.id, adapter)
    this.subscriptions.set(adapter.id, adapter.onNativeFallback((signal) => this.emitFallback(signal)))
    return adapter
  }

  unregister(id: string): boolean {
    const subscription = this.subscriptions.get(id)
    subscription?.()
    this.subscriptions.delete(id)
    return this.adapters.delete(id)
  }

  clear(): void {
    for (const id of this.adapters.keys()) this.unregister(id)
  }

  get(id: string): AndroidControlAdapter | undefined {
    return this.adapters.get(id)
  }

  list(): readonly AndroidControlAdapter[] {
    return [...this.adapters.values()]
  }

  onNativeFallback(listener: (signal: AndroidNativeFallbackSignal) => void): () => void {
    this.fallbackListeners.add(listener)
    return () => this.fallbackListeners.delete(listener)
  }

  getLastFallbackSignal(): AndroidNativeFallbackSignal | null {
    return this.lastFallbackSignal
  }

  async connect(): Promise<void> {
    const enabled = this.list().filter((adapter) => !adapter.isDisabled())
    for (const adapter of enabled) {
      try {
        await adapter.connect()
      } catch {
        adapter.disable('companion_handshake_failed')
      }
    }
  }

  async execute(action: CanonicalAndroidAction, options: AndroidCompanionDispatchOptions = {}): Promise<CanonicalActionResult> {
    return this.call(action.capability, action.parameters, options)
  }

  async close(): Promise<void> {
    await Promise.all(this.list().map((adapter) => adapter.close()))
  }

  disable(id: string, reason = 'companion_disabled'): AndroidNativeFallbackSignal | null {
    const adapter = this.adapters.get(id)
    return adapter?.disable(reason) || null
  }

  enable(id: string): boolean {
    const adapter = this.adapters.get(id)
    if (!adapter) return false
    adapter.enable()
    return true
  }

  getCanonicalCapabilities(id?: string): readonly AndroidCanonicalCapability[] {
    if (id) return this.adapters.get(id)?.getCanonicalCapabilities() || []
    const capabilities = new Set<AndroidCanonicalCapability>()
    for (const adapter of this.adapters.values()) {
      for (const capability of adapter.getCanonicalCapabilities()) capabilities.add(capability)
    }
    return ANDROID_CANONICAL_CAPABILITIES.filter((capability) => capabilities.has(capability))
  }

  async call(
    capability: AndroidCanonicalCapability,
    parameters: AndroidControlParameters = {},
    options: AndroidCompanionDispatchOptions = {}
  ): Promise<AndroidControlResult> {
    if (!CAPABILITY_SET.has(capability)) {
      throw new AndroidCompanionConfigurationError('companion_capability_unsupported')
    }
    const requestedId = options.companionId || options.adapterId
    const candidates = requestedId
      ? [this.adapters.get(requestedId)].filter((adapter): adapter is AndroidControlAdapter => Boolean(adapter))
      : [...this.adapters.values()].filter((adapter) => adapter.supports(capability) && !adapter.isDisabled())

    if (!candidates.length) {
      return {
        companionId: requestedId || '',
        protocol: 'yachiyo-http',
        capability,
        success: false,
        ok: false,
        error: { code: 'companion_unavailable', message: 'No enabled companion supports this capability', retryable: false },
        responseBytes: 0,
        truncated: false,
        fallbackToNative: true,
        disabled: false,
      }
    }

    let last: AndroidControlResult | undefined
    for (const adapter of candidates) {
      last = await adapter.call(capability, parameters, options)
      if (last.success) return last
    }
    return last!
  }

  observe(request: AndroidObserveRequest = {}, options?: AndroidCompanionDispatchOptions) {
    return this.call('observe', request, options)
  }
  find(request: AndroidFindRequest | AndroidNodeSelector, options?: AndroidCompanionDispatchOptions) {
    return this.call('find', 'selector' in request ? request : { selector: request }, options)
  }
  click(request: AndroidClickRequest | AndroidNodeSelector, options?: AndroidCompanionDispatchOptions) {
    return this.call('click', 'selector' in request ? request : { selector: request }, options)
  }
  setText(request: AndroidSetTextRequest | AndroidNodeSelector, text?: string, options?: AndroidCompanionDispatchOptions) {
    return this.call('setText', 'selector' in request ? request : { selector: request, text: text || '' }, options)
  }
  scroll(
    request: AndroidScrollRequest | AndroidNodeSelector,
    direction?: AndroidScrollDirection,
    options?: AndroidCompanionDispatchOptions
  ) {
    return this.call('scroll', 'selector' in request ? request : { selector: request, direction: direction || 'forward' }, options)
  }
  launch(request: AndroidLaunchRequest | string, options?: AndroidCompanionDispatchOptions) {
    return this.call('launch', typeof request === 'string' ? { packageName: request } : request, options)
  }
  verify(request: AndroidVerifyRequest = {}, options?: AndroidCompanionDispatchOptions) {
    return this.call('verify', request, options)
  }

  private emitFallback(signal: AndroidNativeFallbackSignal): void {
    this.lastFallbackSignal = signal
    this.fallbackListeners.forEach((listener) => listener(signal))
  }
}

export function createAndroidControlAdapter(options: AndroidControlAdapterOptions): AndroidControlAdapter {
  return new AndroidControlAdapter(options)
}

export function createAndroidCompanionRegistry(
  options: AndroidCompanionRegistryOptions = {}
): AndroidCompanionRegistry {
  return new AndroidCompanionRegistry(options)
}
