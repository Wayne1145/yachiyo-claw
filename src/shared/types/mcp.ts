import { z } from 'zod'

export type MCPServerConfig<TransportConfig = MCPTransportConfig> = {
  id: string
  name: string
  enabled: boolean
  transport: TransportConfig
  manifest?: MCPServerManifest
}

export type MCPOAuthConfig = {
  enabled: boolean
  /** Optional pre-registered public client id. Omit to use dynamic registration. */
  clientId?: string
  scopes?: string[]
  redirectUri?: string
  resourceMetadataUrl?: string
}

export type MCPTransportConfig =
  | {
      type: 'stdio'
      command: string
      args: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
      /** Desktop compatibility field. Mobile validation rejects inline headers. */
      headers?: Record<string, string>
      /** References into a platform secure store; values must never be serialized here. */
      secretRefs?: MCPSecretRef[]
      /** Streamable HTTP is preferred on mobile; SSE is a compatibility fallback. */
      protocol?: 'streamable-http' | 'sse'
      oauth?: MCPOAuthConfig
    }

export type MCPServerStatus = {
  state: 'idle' | 'starting' | 'running' | 'stopping'
  error?: string
}

export type MCPSecretKind = 'header' | 'api-key' | 'oauth-access-token' | 'oauth-refresh-token'

export type MCPSecretRef = {
  id: string
  kind: MCPSecretKind
  label?: string
  /** Header name is metadata only; the header value remains in the secure vault. */
  headerName?: string
  createdAt?: string
  updatedAt?: string
}

export type MCPServerManifest = {
  protocolVersion?: string
  capabilities?: string[]
  tools?: Array<{ name: string; description?: string; readOnly?: boolean }>
  resources?: Array<{ uri: string; name?: string }>
  prompts?: Array<{ name: string; description?: string }>
  requiresRoots?: boolean
}

export type MCPMobileServerConfig = {
  id: string
  name: string
  enabled: boolean
  transport: {
    type: 'http'
    url: string
    protocol?: 'streamable-http' | 'sse'
    secretRefs: MCPSecretRef[]
    oauth?: MCPOAuthConfig
  }
  manifest?: MCPServerManifest
}

export type MCPMobileValidationIssue = {
  code:
    | 'invalid_shape'
    | 'stdio_unsupported'
    | 'https_required'
    | 'private_network_blocked'
    | 'raw_credentials'
    | 'duplicate_secret_ref'
    | 'invalid_secret_ref'
  message: string
  path?: string
}

const SecretRefIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const MCPSecretRefSchema = z
  .object({
    id: SecretRefIdSchema,
    kind: z.enum(['header', 'api-key', 'oauth-access-token', 'oauth-refresh-token']),
    label: z.string().max(256).optional(),
    headerName: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,128}$/)
      .optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()

export const MCPServerManifestSchema = z
  .object({
    protocolVersion: z.string().max(64).optional(),
    capabilities: z.array(z.string().min(1).max(128)).max(256).optional(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            description: z.string().max(4096).optional(),
            readOnly: z.boolean().optional(),
          })
          .strict()
      )
      .max(4096)
      .optional(),
    resources: z
      .array(
        z
          .object({
            uri: z.string().url(),
            name: z.string().max(256).optional(),
          })
          .strict()
      )
      .max(4096)
      .optional(),
    prompts: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            description: z.string().max(4096).optional(),
          })
          .strict()
      )
      .max(4096)
      .optional(),
    requiresRoots: z.boolean().optional(),
  })
  .strict()

export const MCPOAuthConfigSchema = z
  .object({
    enabled: z.boolean(),
    clientId: z.string().trim().min(1).max(512).optional(),
    scopes: z.array(z.string().trim().min(1).max(256)).max(64).optional(),
    redirectUri: z
      .string()
      .url()
      .refine(
        (value) => value === 'yachiyoclaw://oauth/mcp' || value === 'yachiyoclaw-dev://oauth/mcp',
        'MCP OAuth redirects must use the Yachiyo Claw callback.'
      )
      .optional(),
    resourceMetadataUrl: z.string().url().optional(),
  })
  .strict()

export const MCPMobileServerConfigSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    enabled: z.boolean(),
    transport: z
      .object({
        type: z.literal('http'),
        url: z.string().url(),
        protocol: z.enum(['streamable-http', 'sse']).optional(),
        secretRefs: z.array(MCPSecretRefSchema).max(64).default([]),
        oauth: MCPOAuthConfigSchema.optional(),
      })
      .strict(),
    manifest: MCPServerManifestSchema.optional(),
  })
  .strict()

export type MCPSecretRefValue = z.infer<typeof MCPSecretRefSchema>
export type MCPServerManifestValue = z.infer<typeof MCPServerManifestSchema>
export type MCPMobileServerConfigValue = z.infer<typeof MCPMobileServerConfigSchema>

function hasRawCredentialFields(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const transport = (input as { transport?: unknown }).transport
  if (!transport || typeof transport !== 'object') return false
  const value = transport as Record<string, unknown>
  if ('headers' in value || 'env' in value || 'command' in value || 'args' in value) return true
  try {
    const url = new URL(String(value.url || ''))
    if (url.username || url.password) return true
    for (const key of url.searchParams.keys()) {
      if (/(token|secret|key|password|authorization|credential)/i.test(key)) return true
    }
  } catch {
    // Shape errors are returned by the schema below.
  }
  return false
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

/**
 * Validate a persisted mobile MCP configuration. stdio and inline credentials are
 * intentionally rejected; only HTTPS transports plus secure-store references are
 * accepted on Android/iOS.
 */
export function validateMobileMCPServerConfig(
  input: unknown,
  options: { allowLan?: boolean } = {}
): { success: true; data: MCPMobileServerConfigValue } | { success: false; issues: MCPMobileValidationIssue[] } {
  if (input && typeof input === 'object') {
    const transport = (input as { transport?: { type?: unknown } }).transport
    if (transport?.type === 'stdio') {
      return {
        success: false,
        issues: [{ code: 'stdio_unsupported', message: 'stdio MCP transports are unavailable on mobile.' }],
      }
    }
  }

  if (hasRawCredentialFields(input)) {
    return {
      success: false,
      issues: [{ code: 'raw_credentials', message: 'MCP credentials must be stored by secure secret reference.' }],
    }
  }

  const parsed = MCPMobileServerConfigSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.path.includes('secretRefs') ? 'invalid_secret_ref' : 'invalid_shape',
        message: issue.message,
        path: issue.path.join('.'),
      })),
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(parsed.data.transport.url)
  } catch {
    return {
      success: false,
      issues: [{ code: 'invalid_shape', message: 'MCP URL is invalid.', path: 'transport.url' }],
    }
  }
  if (parsedUrl.protocol !== 'https:') {
    return {
      success: false,
      issues: [{ code: 'https_required', message: 'Mobile MCP servers must use HTTPS.', path: 'transport.url' }],
    }
  }
  if (!options.allowLan && isPrivateNetworkHost(parsedUrl.hostname)) {
    return {
      success: false,
      issues: [
        {
          code: 'private_network_blocked',
          message: 'Private-network MCP servers require an explicit LAN policy grant.',
          path: 'transport.url',
        },
      ],
    }
  }

  const ids = new Set<string>()
  for (const ref of parsed.data.transport.secretRefs) {
    if (ids.has(ref.id)) {
      return {
        success: false,
        issues: [
          {
            code: 'duplicate_secret_ref',
            message: `Duplicate MCP secret reference: ${ref.id}`,
            path: 'transport.secretRefs',
          },
        ],
      }
    }
    ids.add(ref.id)
  }

  return { success: true, data: parsed.data }
}

export function assertMobileMCPServerConfig(
  input: unknown,
  options: { allowLan?: boolean } = {}
): MCPMobileServerConfigValue {
  const result = validateMobileMCPServerConfig(input, options)
  if (!result.success) {
    throw new Error(result.issues.map((issue) => issue.message).join('; '))
  }
  return result.data
}
