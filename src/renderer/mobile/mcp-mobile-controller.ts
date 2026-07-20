import { Capacitor } from '@capacitor/core'
import {
  assertMobileMCPServerConfig,
  type MCPMobileServerConfigValue,
  type MCPMobileValidationIssue,
  type MCPSecretRefValue,
  validateMobileMCPServerConfig,
} from '@shared/types/mcp'
import { decryptMobileProtectedValue, encryptMobileProtectedValue } from '@/platform/native/yachiyo_secure_storage'
import { McpHttpService } from './mcp-http-service'
import {
  beginMcpOAuth,
  consumePendingMcpOAuthCallback,
  finishMcpOAuth,
  MobileMcpOAuthProvider,
} from './mcp-oauth-provider'

const CONFIG_STORAGE_KEY = 'yachiyo.mobile.mcp.servers.v1'
const SECRET_STORAGE_PREFIX = 'yachiyo.mobile.mcp.secret.v1:'

export interface MobileMcpConfigStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface MobileMcpSecretVault {
  set(ref: MCPSecretRefValue, value: string): Promise<void>
  get(ref: MCPSecretRefValue): Promise<string | null>
  remove(ref: MCPSecretRefValue): Promise<void>
}

export type MobileMcpControllerOptions = {
  storage?: MobileMcpConfigStorage
  vault?: MobileMcpSecretVault
  isNativePlatform?: () => boolean
  allowLan?: boolean
}

export type MobileMcpRejectedConfig = {
  value: unknown
  issues: MCPMobileValidationIssue[]
}

function getDefaultStorage(): MobileMcpConfigStorage {
  if (typeof localStorage !== 'undefined') {
    return {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    }
  }
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function defaultVault(storage: MobileMcpConfigStorage, isNativePlatform: () => boolean): MobileMcpSecretVault {
  const key = (ref: MCPSecretRefValue) => `${SECRET_STORAGE_PREFIX}${ref.id}`
  return {
    async set(ref, value) {
      if (!isNativePlatform()) throw new Error('mobile_secure_storage_required')
      storage.setItem(key(ref), await encryptMobileProtectedValue(value))
    },
    get(ref) {
      const stored = storage.getItem(key(ref))
      if (!stored) return Promise.resolve(null)
      if (!isNativePlatform()) return Promise.reject(new Error('mobile_secure_storage_required'))
      return decryptMobileProtectedValue(stored)
    },
    remove(ref) {
      storage.removeItem(key(ref))
      return Promise.resolve()
    },
  }
}

function parseStoredConfigs(
  storage: MobileMcpConfigStorage,
  options: { allowLan?: boolean } = {}
): {
  valid: MCPMobileServerConfigValue[]
  rejected: MobileMcpRejectedConfig[]
} {
  const raw = storage.getItem(CONFIG_STORAGE_KEY)
  if (!raw) return { valid: [], rejected: [] }
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    return {
      valid: [],
      rejected: [
        { value: raw, issues: [{ code: 'invalid_shape', message: 'Stored MCP settings are not valid JSON.' }] },
      ],
    }
  }
  if (!Array.isArray(values)) {
    return {
      valid: [],
      rejected: [
        { value: values, issues: [{ code: 'invalid_shape', message: 'Stored MCP settings must be an array.' }] },
      ],
    }
  }
  const valid: MCPMobileServerConfigValue[] = []
  const rejected: MobileMcpRejectedConfig[] = []
  for (const value of values) {
    const result = validateMobileMCPServerConfig(value, options)
    if (result.success) valid.push(result.data)
    else rejected.push({ value, issues: result.issues })
  }
  return { valid, rejected }
}

function persistConfigs(storage: MobileMcpConfigStorage, configs: MCPMobileServerConfigValue[]): void {
  storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configs))
}

function secretHeaderName(ref: MCPSecretRefValue): string {
  if (ref.headerName) return ref.headerName
  if (ref.kind === 'oauth-access-token') return 'Authorization'
  if (ref.kind === 'api-key') return 'X-API-Key'
  return 'Authorization'
}

/**
 * Mobile MCP configuration, OAuth and secret-reference controller. Persisted
 * configuration contains metadata only; tokens and verifiers stay in the native vault.
 */
export class MobileMcpController {
  private readonly storage: MobileMcpConfigStorage
  private readonly vault: MobileMcpSecretVault
  private readonly isNativePlatform: () => boolean
  private readonly allowLan: boolean

  constructor(options: MobileMcpControllerOptions = {}) {
    this.storage = options.storage || getDefaultStorage()
    this.isNativePlatform = options.isNativePlatform || (() => Capacitor.isNativePlatform())
    this.allowLan = options.allowLan ?? false
    this.vault = options.vault || defaultVault(this.storage, this.isNativePlatform)
  }

  list(): MCPMobileServerConfigValue[] {
    return parseStoredConfigs(this.storage, { allowLan: this.allowLan }).valid
  }

  listWithIssues(): { servers: MCPMobileServerConfigValue[]; rejected: MobileMcpRejectedConfig[] } {
    const parsed = parseStoredConfigs(this.storage, { allowLan: this.allowLan })
    return { servers: parsed.valid, rejected: parsed.rejected }
  }

  upsert(value: unknown): MCPMobileServerConfigValue {
    const config = assertMobileMCPServerConfig(value, { allowLan: this.allowLan })
    const current = this.list().filter((server) => server.id !== config.id)
    current.push(config)
    persistConfigs(this.storage, current)
    return config
  }

  remove(id: string): void {
    const current = this.list().filter((server) => server.id !== id)
    persistConfigs(this.storage, current)
  }

  setEnabled(id: string, enabled: boolean): MCPMobileServerConfigValue {
    const current = this.list()
    const server = current.find((candidate) => candidate.id === id)
    if (!server) throw new Error('mobile_mcp_server_not_found')
    server.enabled = enabled
    persistConfigs(this.storage, current)
    return server
  }

  async saveSecret(ref: MCPSecretRefValue, value: string): Promise<void> {
    if (!value.trim()) throw new Error('mobile_mcp_secret_required')
    await this.vault.set(ref, value)
  }

  async removeSecret(ref: MCPSecretRefValue): Promise<void> {
    await this.vault.remove(ref)
  }

  /** Resolve secret references for one request without mutating persisted config. */
  async resolveHeaders(config: unknown): Promise<Record<string, string>> {
    const parsed = assertMobileMCPServerConfig(config, { allowLan: this.allowLan })
    const headers: Record<string, string> = {}
    for (const ref of parsed.transport.secretRefs) {
      if (parsed.transport.oauth?.enabled && ref.kind.startsWith('oauth-')) continue
      if (ref.kind === 'oauth-refresh-token') throw new Error('mobile_mcp_oauth_config_required')
      const value = await this.vault.get(ref)
      if (!value) throw new Error(`mobile_mcp_secret_missing:${ref.id}`)
      headers[secretHeaderName(ref)] = ref.kind === 'oauth-access-token' ? `Bearer ${value}` : value
    }
    return headers
  }

  createOAuthProvider(config: unknown): MobileMcpOAuthProvider | undefined {
    const parsed = assertMobileMCPServerConfig(config, { allowLan: this.allowLan })
    if (!parsed.transport.oauth?.enabled) return undefined
    return new MobileMcpOAuthProvider({
      config: parsed,
      storage: this.storage,
      vault: this.vault,
    })
  }

  async beginOAuth(config: unknown): Promise<MCPMobileServerConfigValue> {
    const parsed = this.upsert(config)
    if (!parsed.transport.oauth?.enabled) throw new Error('mcp_oauth_not_enabled')
    await beginMcpOAuth({ config: parsed, storage: this.storage, vault: this.vault })
    return parsed
  }

  async finishOAuthCallback(callbackUrl: string): Promise<MCPMobileServerConfigValue> {
    const pending = await consumePendingMcpOAuthCallback({ callbackUrl, storage: this.storage })
    const config = this.list().find((candidate) => candidate.id === pending.serverId)
    if (!config) throw new Error('mobile_mcp_server_not_found')
    await finishMcpOAuth({
      config,
      storage: this.storage,
      vault: this.vault,
      authorizationCode: pending.code,
    })
    return config
  }

  /** Build a transport with ephemeral headers; no secret is written into the manifest. */
  async createHttpService(config: unknown): Promise<McpHttpService> {
    const parsed = assertMobileMCPServerConfig(config, { allowLan: this.allowLan })
    const headers = await this.resolveHeaders(parsed)
    if (parsed.transport.oauth?.enabled) {
      const tokens = await this.createOAuthProvider(parsed)?.tokens()
      if (!tokens?.access_token) throw new Error('mobile_mcp_oauth_login_required')
      headers.Authorization = `${tokens.token_type || 'Bearer'} ${tokens.access_token}`
    }
    return new McpHttpService({
      endpoint: parsed.transport.url,
      headers,
      policy: { allowLan: this.allowLan },
      protocolVersion: parsed.manifest?.protocolVersion,
    })
  }

  async testConnection(config: unknown): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    try {
      const client = await this.createHttpService(config)
      const response = await client.call({
        jsonrpc: '2.0',
        id: `health-${Date.now()}`,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'yachiyo-claw', version: '1' } },
      })
      return { ok: response.messages.length > 0, sessionId: response.sessionId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'mobile_mcp_connection_failed' }
    }
  }

  getAuthStatus(): { oauth2Pkce: 'supported'; discovery: 'rfc9728'; secretReferences: 'supported' } {
    return { oauth2Pkce: 'supported', discovery: 'rfc9728', secretReferences: 'supported' }
  }
}

export const mobileMcpController = new MobileMcpController()

export function parseMobileMcpConfig(value: unknown): MCPMobileServerConfigValue | null {
  const result = validateMobileMCPServerConfig(value)
  return result.success ? result.data : null
}
