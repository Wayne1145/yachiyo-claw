export interface McpEndpointPolicy {
  allowLan?: boolean
  allowedHosts?: readonly string[]
  allowedPorts?: readonly number[]
}

export interface McpHttpServiceOptions {
  endpoint: string
  headers?: Record<string, string>
  policy?: McpEndpointPolicy
  protocolVersion?: string
  maxResponseBytes?: number
  fetchImpl?: typeof fetch
}

export interface McpHttpResponse<T = unknown> {
  messages: T[]
  sessionId?: string
  resumable: boolean
}

export interface McpPkceStateStore {
  set(state: string, value: { verifier: string; redirectUri: string; expiresAt: number }): Promise<void>
  take(state: string): Promise<{ verifier: string; redirectUri: string; expiresAt: number } | null>
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const SENSITIVE_QUERY_KEY = /(?:token|secret|password|passwd|authorization|api[-_]?key|access[-_]?key)/i

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
  )
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    isPrivateIpv4(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  )
}

export function assertSafeMcpEndpoint(input: string, policy: McpEndpointPolicy = {}): URL {
  let endpoint: URL
  try {
    endpoint = new URL(input)
  } catch {
    throw new Error('mcp_endpoint_invalid')
  }
  if (endpoint.protocol !== 'https:') throw new Error('mcp_https_required')
  if (endpoint.username || endpoint.password) throw new Error('mcp_url_credentials_forbidden')
  for (const key of endpoint.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) throw new Error('mcp_secret_query_forbidden')
  }
  if (!policy.allowLan && isPrivateHostname(endpoint.hostname)) throw new Error('mcp_private_endpoint_blocked')
  if (policy.allowedHosts?.length) {
    const allowed = policy.allowedHosts.some((host) => host.toLowerCase() === endpoint.hostname.toLowerCase())
    if (!allowed) throw new Error('mcp_host_not_allowed')
  }
  if (policy.allowedPorts?.length) {
    const port = endpoint.port ? Number(endpoint.port) : 443
    if (!policy.allowedPorts.includes(port)) throw new Error('mcp_port_not_allowed')
  }
  return endpoint
}

function boundedJson(value: unknown, depth = 0): unknown {
  if (depth >= 12) return '[truncated]'
  if (typeof value === 'string') return value.length > 32_768 ? `${value.slice(0, 32_768)}[truncated]` : value
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => boundedJson(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 1_000)
        .map(([key, item]) => [key, boundedJson(item, depth + 1)])
    )
  }
  return value
}

function parseSse(text: string): unknown[] {
  const messages: unknown[] = []
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const payload = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!payload || payload === '[DONE]') continue
    try {
      messages.push(boundedJson(JSON.parse(payload)))
    } catch {
      throw new Error('mcp_sse_payload_invalid')
    }
  }
  return messages
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('mcp_response_too_large')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error('mcp_response_too_large')
  return new TextDecoder().decode(bytes)
}

/**
 * Streamable HTTP transport for Android. It never supports stdio and accepts
 * secrets only as ephemeral headers supplied by the caller.
 */
export class McpHttpService {
  private readonly endpoint: URL
  private readonly fetchImpl: typeof fetch
  private readonly headers: Record<string, string>
  private readonly protocolVersion: string
  private readonly maxResponseBytes: number
  private sessionId?: string

  constructor(options: McpHttpServiceOptions) {
    this.endpoint = assertSafeMcpEndpoint(options.endpoint, options.policy)
    this.fetchImpl = options.fetchImpl || fetch
    this.headers = { ...(options.headers || {}) }
    this.protocolVersion = options.protocolVersion || DEFAULT_PROTOCOL_VERSION
    this.maxResponseBytes = options.maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES
  }

  getSessionId(): string | undefined {
    return this.sessionId
  }

  clearSession(): void {
    this.sessionId = undefined
  }

  async call<T = unknown>(message: unknown, signal?: AbortSignal): Promise<McpHttpResponse<T>> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': this.protocolVersion,
      ...this.headers,
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) this.sessionId = undefined
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      throw new Error(retryable ? `mcp_retryable_http_${response.status}` : `mcp_http_${response.status}`)
    }
    const nextSessionId = response.headers.get('mcp-session-id') || undefined
    if (nextSessionId) this.sessionId = nextSessionId.slice(0, 512)
    if (response.status === 202 || response.status === 204) {
      return { messages: [], sessionId: this.sessionId, resumable: Boolean(this.sessionId) }
    }
    const text = await readBoundedResponse(response, this.maxResponseBytes)
    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const messages = contentType.includes('text/event-stream')
      ? parseSse(text)
      : [boundedJson(JSON.parse(text))]
    return { messages: messages as T[], sessionId: this.sessionId, resumable: Boolean(this.sessionId) }
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (!this.sessionId) return
    const sessionId = this.sessionId
    this.sessionId = undefined
    await this.fetchImpl(this.endpoint, {
      method: 'DELETE',
      headers: {
        'MCP-Protocol-Version': this.protocolVersion,
        'Mcp-Session-Id': sessionId,
        ...this.headers,
      },
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomUrlToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function createMcpPkceAuthorization(input: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  scopes: string[]
  store: McpPkceStateStore
  now?: number
}): Promise<{ url: string; state: string }> {
  const endpoint = assertSafeMcpEndpoint(input.authorizationEndpoint)
  const redirect = new URL(input.redirectUri)
  if (!['https:', 'yachiyoclaw:'].includes(redirect.protocol)) throw new Error('mcp_oauth_redirect_invalid')
  const verifier = randomUrlToken(48)
  const state = randomUrlToken(32)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  await input.store.set(state, {
    verifier,
    redirectUri: redirect.toString(),
    expiresAt: (input.now ?? Date.now()) + 10 * 60 * 1_000,
  })
  endpoint.searchParams.set('response_type', 'code')
  endpoint.searchParams.set('client_id', input.clientId)
  endpoint.searchParams.set('redirect_uri', redirect.toString())
  endpoint.searchParams.set('scope', input.scopes.join(' '))
  endpoint.searchParams.set('state', state)
  endpoint.searchParams.set('code_challenge', base64Url(digest))
  endpoint.searchParams.set('code_challenge_method', 'S256')
  return { url: endpoint.toString(), state }
}

export async function consumeMcpPkceCallback(input: {
  callbackUrl: string
  store: McpPkceStateStore
  now?: number
}): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const callback = new URL(input.callbackUrl)
  const state = callback.searchParams.get('state') || ''
  const code = callback.searchParams.get('code') || ''
  if (!state || !code) throw new Error('mcp_oauth_callback_invalid')
  const record = await input.store.take(state)
  if (!record || record.expiresAt <= (input.now ?? Date.now())) throw new Error('mcp_oauth_state_invalid')
  return { code, verifier: record.verifier, redirectUri: record.redirectUri }
}
