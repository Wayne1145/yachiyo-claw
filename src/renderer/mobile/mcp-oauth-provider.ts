import { Browser } from '@capacitor/browser'
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { MCPMobileServerConfigValue, MCPSecretRefValue } from '@shared/types/mcp'
import { decryptMobileProtectedValue, encryptMobileProtectedValue } from '@/platform/native/yachiyo_secure_storage'
import { assertSafeMcpEndpoint } from './mcp-http-service'

const OAUTH_PENDING_PREFIX = 'yachiyo.mobile.mcp.oauth.pending.v1:'
const OAUTH_ACTIVE_PREFIX = 'yachiyo.mobile.mcp.oauth.active.v1:'
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1_000

export interface McpOAuthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface McpOAuthVault {
  set(ref: MCPSecretRefValue, value: string): Promise<void>
  get(ref: MCPSecretRefValue): Promise<string | null>
  remove(ref: MCPSecretRefValue): Promise<void>
}

export interface McpOAuthProviderOptions {
  config: MCPMobileServerConfigValue
  storage: McpOAuthStorage
  vault: McpOAuthVault
  openExternal?: (url: string) => Promise<void>
  protect?: (plaintext: string) => Promise<string>
  unprotect?: (envelope: string) => Promise<string>
  now?: () => number
  fetchImpl?: typeof fetch
}

interface PendingOAuthState {
  serverId: string
  expiresAt: number
}

async function stableId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function internalRef(
  serverId: string,
  suffix: string,
  kind: MCPSecretRefValue['kind']
): Promise<MCPSecretRefValue> {
  return { id: `mcp.oauth.${await stableId(serverId)}.${suffix}`, kind }
}

function activeStateKey(serverId: string): string {
  return `${OAUTH_ACTIVE_PREFIX}${encodeURIComponent(serverId)}`
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function validateConfig(config: MCPMobileServerConfigValue): void {
  if (!config.transport.oauth?.enabled) throw new Error('mcp_oauth_not_enabled')
  assertSafeMcpEndpoint(config.transport.url)
  if (config.transport.oauth.resourceMetadataUrl) {
    assertSafeMcpEndpoint(config.transport.oauth.resourceMetadataUrl)
  }
}

export class MobileMcpOAuthProvider implements OAuthClientProvider {
  private readonly config: MCPMobileServerConfigValue
  private readonly storage: McpOAuthStorage
  private readonly vault: McpOAuthVault
  private readonly openExternal: (url: string) => Promise<void>
  private readonly protect: (plaintext: string) => Promise<string>
  private readonly now: () => number

  constructor(options: McpOAuthProviderOptions) {
    validateConfig(options.config)
    this.config = options.config
    this.storage = options.storage
    this.vault = options.vault
    this.openExternal = options.openExternal || ((url) => Browser.open({ url }).then(() => undefined))
    this.protect = options.protect || encryptMobileProtectedValue
    this.now = options.now || Date.now
  }

  get redirectUrl(): string {
    return this.config.transport.oauth?.redirectUri || 'yachiyoclaw://oauth/mcp'
  }

  get clientMetadata(): OAuthClientMetadata {
    const scopes = this.config.transport.oauth?.scopes || []
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Yachiyo Claw',
      scope: scopes.length ? scopes.join(' ') : undefined,
    }
  }

  async state(): Promise<string> {
    const activeKey = activeStateKey(this.config.id)
    const activeUntil = Number(this.storage.getItem(activeKey) || 0)
    if (activeUntil > this.now()) throw new Error('mcp_oauth_already_pending')
    const state = randomToken()
    const record: PendingOAuthState = {
      serverId: this.config.id,
      expiresAt: this.now() + OAUTH_PENDING_TTL_MS,
    }
    this.storage.setItem(`${OAUTH_PENDING_PREFIX}${state}`, await this.protect(JSON.stringify(record)))
    this.storage.setItem(activeKey, String(record.expiresAt))
    return state
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const clientId = this.config.transport.oauth?.clientId
    if (clientId) return { client_id: clientId }
    return parseJson<OAuthClientInformationMixed>(
      await this.vault.get(await internalRef(this.config.id, 'client', 'header'))
    )
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.vault.set(await internalRef(this.config.id, 'client', 'header'), JSON.stringify(clientInformation))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return parseJson<OAuthTokens>(
      await this.vault.get(await internalRef(this.config.id, 'tokens', 'oauth-access-token'))
    )
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.vault.set(
      await internalRef(this.config.id, 'tokens', 'oauth-access-token'),
      JSON.stringify(tokens)
    )
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    assertSafeMcpEndpoint(authorizationUrl.toString())
    await this.openExternal(authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.vault.set(await internalRef(this.config.id, 'verifier', 'header'), codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.vault.get(await internalRef(this.config.id, 'verifier', 'header'))
    if (!verifier) throw new Error('mcp_oauth_verifier_missing')
    return verifier
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.vault.set(await internalRef(this.config.id, 'discovery', 'header'), JSON.stringify(state))
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return parseJson<OAuthDiscoveryState>(
      await this.vault.get(await internalRef(this.config.id, 'discovery', 'header'))
    )
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const suffixes =
      scope === 'all'
        ? (['client', 'tokens', 'verifier', 'discovery'] as const)
        : ([scope] as const)
    for (const suffix of suffixes) {
      const kind = suffix === 'tokens' ? 'oauth-access-token' : 'header'
      await this.vault.remove(await internalRef(this.config.id, suffix, kind))
    }
  }
}

export function createSafeMcpOAuthFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    assertSafeMcpEndpoint(url)
    return fetchImpl(input, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
  }) as typeof fetch
}

export async function beginMcpOAuth(options: McpOAuthProviderOptions): Promise<void> {
  const provider = new MobileMcpOAuthProvider(options)
  await auth(provider, {
    serverUrl: options.config.transport.url,
    scope: options.config.transport.oauth?.scopes?.join(' '),
    resourceMetadataUrl: options.config.transport.oauth?.resourceMetadataUrl
      ? new URL(options.config.transport.oauth.resourceMetadataUrl)
      : undefined,
    fetchFn: createSafeMcpOAuthFetch(options.fetchImpl),
  })
}

export async function consumePendingMcpOAuthCallback(input: {
  callbackUrl: string
  storage: McpOAuthStorage
  unprotect?: (envelope: string) => Promise<string>
  now?: number
}): Promise<{ serverId: string; code: string }> {
  const callback = new URL(input.callbackUrl)
  if (
    !['yachiyoclaw:', 'yachiyoclaw-dev:'].includes(callback.protocol) ||
    callback.hostname !== 'oauth' ||
    callback.pathname !== '/mcp'
  ) {
    throw new Error('mcp_oauth_callback_invalid')
  }
  const state = callback.searchParams.get('state') || ''
  const code = callback.searchParams.get('code') || ''
  const oauthError = callback.searchParams.get('error') || ''
  if (!state) throw new Error('mcp_oauth_callback_invalid')

  const key = `${OAUTH_PENDING_PREFIX}${state}`
  const envelope = input.storage.getItem(key)
  input.storage.removeItem(key)
  if (!envelope) throw new Error('mcp_oauth_state_invalid')
  const unprotect = input.unprotect || decryptMobileProtectedValue
  const record = parseJson<PendingOAuthState>(await unprotect(envelope))
  if (!record || !record.serverId || record.expiresAt <= (input.now ?? Date.now())) {
    throw new Error('mcp_oauth_state_invalid')
  }
  input.storage.removeItem(activeStateKey(record.serverId))
  if (oauthError) throw new Error(`mcp_oauth_denied:${oauthError.slice(0, 128)}`)
  if (!code) throw new Error('mcp_oauth_callback_invalid')
  return { serverId: record.serverId, code }
}

export async function finishMcpOAuth(
  options: McpOAuthProviderOptions & { authorizationCode: string }
): Promise<void> {
  const provider = new MobileMcpOAuthProvider(options)
  await auth(provider, {
    serverUrl: options.config.transport.url,
    authorizationCode: options.authorizationCode,
    scope: options.config.transport.oauth?.scopes?.join(' '),
    resourceMetadataUrl: options.config.transport.oauth?.resourceMetadataUrl
      ? new URL(options.config.transport.oauth.resourceMetadataUrl)
      : undefined,
    fetchFn: createSafeMcpOAuthFetch(options.fetchImpl),
  })
  await provider.invalidateCredentials('verifier')
}
