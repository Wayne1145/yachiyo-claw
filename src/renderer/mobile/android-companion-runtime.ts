import type { MCPMobileServerConfigValue } from '@shared/types/mcp'
import { setAndroidCompanionRegistry } from './agent-broker'
import { mobileMcpController } from './mcp-mobile-controller'
import {
  ANDROID_CANONICAL_CAPABILITIES,
  type AndroidCanonicalCapability,
  type AndroidCompanionConnectionPolicy,
  type AndroidCompanionProtocol,
  type AndroidControlAdapter,
  AndroidCompanionRegistry,
  createAndroidControlAdapter,
  validateCompanionUrl,
} from './android-companion'

export interface ExplicitAndroidCompanionEndpoint {
  id: string
  name?: string
  protocol: AndroidCompanionProtocol
  url: string
  bearerToken?: string
  headers?: Record<string, string>
  capabilities?: readonly AndroidCanonicalCapability[]
  allowedTunAddresses?: readonly string[]
}

export interface AndroidCompanionRuntimeOptions {
  allowedTunAddresses?: readonly string[]
  explicitEndpoints?: readonly ExplicitAndroidCompanionEndpoint[]
  registry?: AndroidCompanionRegistry
  /** Do not connect or probe arbitrary network hosts; only validate/register. */
  includeStoredMobileMcp?: boolean
}

function capabilityFromName(name: string): AndroidCanonicalCapability | undefined {
  const normalized = name.replace(/^android[_./-]?/i, '').replace(/[_-]/g, '').toLowerCase()
  return ANDROID_CANONICAL_CAPABILITIES.find((capability) => capability.toLowerCase() === normalized)
}

function capabilitiesFromManifest(config: MCPMobileServerConfigValue): AndroidCanonicalCapability[] {
  const names = config.manifest?.tools?.map((tool) => tool.name) || []
  const mapped = names.map(capabilityFromName).filter((value): value is AndroidCanonicalCapability => Boolean(value))
  return mapped.length ? [...new Set(mapped)] : [...ANDROID_CANONICAL_CAPABILITIES]
}

function policy(addresses: readonly string[] | undefined): AndroidCompanionConnectionPolicy {
  return addresses?.length ? { allowedTunAddresses: addresses } : {}
}

async function adapterFromStoredConfig(
  config: MCPMobileServerConfigValue,
  addresses: readonly string[]
): Promise<AndroidControlAdapter> {
  const headers = await mobileMcpController.resolveHeaders(config)
  const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1]
  const defaultBearerToken = authorization?.replace(/^Bearer\s+/i, '')
  const defaultHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'authorization')
  )
  validateCompanionUrl(config.transport.url, policy(addresses))
  return createAndroidControlAdapter({
    id: config.id,
    name: config.name,
    protocol: config.id.toLowerCase().includes('remote-control') ? 'android-remote-control' : 'generic-mcp-http',
    url: config.transport.url,
    capabilities: capabilitiesFromManifest(config),
    defaultBearerToken,
    defaultHeaders,
    allowedTunAddresses: addresses,
  })
}

/**
 * Build the optional companion registry from explicitly configured endpoints.
 * There is no LAN scan and no unknown-host discovery in this function.
 */
export async function configureAndroidCompanions(
  options: AndroidCompanionRuntimeOptions = {}
): Promise<AndroidCompanionRegistry> {
  const registry = options.registry || new AndroidCompanionRegistry()
  const addresses = options.allowedTunAddresses || []
  const adapters: AndroidControlAdapter[] = []
  for (const endpoint of options.explicitEndpoints || []) {
    validateCompanionUrl(endpoint.url, policy([...(addresses || []), ...(endpoint.allowedTunAddresses || [])]))
    adapters.push(
      createAndroidControlAdapter({
        id: endpoint.id,
        name: endpoint.name,
        protocol: endpoint.protocol,
        url: endpoint.url,
        defaultBearerToken: endpoint.bearerToken,
        defaultHeaders: endpoint.headers,
        capabilities: endpoint.capabilities,
        allowedTunAddresses: [...addresses, ...(endpoint.allowedTunAddresses || [])],
      })
    )
  }
  if (options.includeStoredMobileMcp !== false) {
    for (const config of mobileMcpController.list().filter((candidate) => candidate.enabled)) {
      try {
        adapters.push(await adapterFromStoredConfig(config, addresses))
      } catch {
        // A bad/expired secure reference disables this adapter for this run;
        // native Broker execution remains available.
      }
    }
  }
  for (const adapter of adapters) {
    try {
      registry.register(adapter)
    } catch {
      await adapter.close().catch(() => undefined)
    }
  }
  setAndroidCompanionRegistry(registry)
  return registry
}

export function clearAndroidCompanions(registry?: AndroidCompanionRegistry): void {
  const target = registry
  target?.clear()
  if (!registry) setAndroidCompanionRegistry(null)
}
