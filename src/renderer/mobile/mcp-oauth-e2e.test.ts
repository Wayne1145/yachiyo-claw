import type { MCPSecretRefValue } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'
import { MobileMcpController, type MobileMcpConfigStorage, type MobileMcpSecretVault } from './mcp-mobile-controller'
import { TemporaryMcpOAuthTestService } from './mcp-oauth-test-service'
import { acceptMobileDeepLink, consumePendingMcpOAuthCallback } from '@/platform/mobile_deep_link'

function storage(): MobileMcpConfigStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function vault(): MobileMcpSecretVault & { values: Map<string, string> } {
  const values = new Map<string, string>()
  const key = (ref: MCPSecretRefValue) => `${ref.kind}:${ref.id}`
  return {
    values,
    set: async (ref, value) => void values.set(key(ref), value),
    get: async (ref) => values.get(key(ref)) || null,
    remove: async (ref) => void values.delete(key(ref)),
  }
}

describe('mobile MCP OAuth end-to-end', () => {
  it('completes discovery, PKCE callback, token refresh, and an authenticated MCP request', async () => {
    const service = new TemporaryMcpOAuthTestService()
    const configStorage = storage()
    const secretVault = vault()
    const openedUrls: string[] = []
    let now = 1_000
    const controller = new MobileMcpController({
      storage: configStorage,
      vault: secretVault,
      isNativePlatform: () => true,
      oauthFetch: service.fetch,
      httpFetch: service.fetch,
      oauthOpenExternal: async (url) => void openedUrls.push(url),
      oauthProtect: async (value) => `protected:${value}`,
      oauthUnprotect: async (value) => value.replace(/^protected:/, ''),
      oauthNow: () => now,
    })
    const config = {
      id: 'temporary-oauth-mcp',
      name: 'Temporary OAuth MCP',
      enabled: true,
      transport: {
        type: 'http' as const,
        url: service.resource,
        protocol: 'streamable-http' as const,
        secretRefs: [],
        oauth: {
          enabled: true,
          clientId: 'yachiyo-mobile-e2e',
          scopes: ['mcp:tools'],
          redirectUri: 'yachiyoclaw://oauth/mcp',
          resourceMetadataUrl: service.resourceMetadata,
        },
      },
    }

    await controller.beginOAuth(config)
    expect(openedUrls).toHaveLength(1)
    const authorizationUrl = new URL(openedUrls[0])
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(service.authorizationEndpoint)
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorizationUrl.searchParams.get('resource')).toBe(service.resource)

    const callbackUrl = await service.authorize(openedUrls[0])
    now = 2_000
    expect(acceptMobileDeepLink(callbackUrl)).toEqual({ kind: 'handled' })
    const acceptedCallback = consumePendingMcpOAuthCallback()
    expect(acceptedCallback).toBe(callbackUrl)
    expect(consumePendingMcpOAuthCallback()).toBeNull()
    await controller.finishOAuthCallback(acceptedCallback!)
    expect(service.tokenExchangeCount).toBe(1)
    expect(service.observedTokenBodies[0].get('code_verifier')).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    expect(service.observedTokenBodies[0].get('grant_type')).toBe('authorization_code')
    await expect(controller.finishOAuthCallback(callbackUrl)).rejects.toThrow('mcp_oauth_state_invalid')

    const persistedConfig = JSON.stringify([...configStorage.values.values()])
    expect(persistedConfig).not.toContain('access-1')
    expect(persistedConfig).not.toContain('refresh-1')
    expect(persistedConfig).not.toContain(service.observedTokenBodies[0].get('code_verifier'))

    const firstClient = await controller.createHttpService(config)
    const firstResponse = await firstClient.call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(firstResponse).toMatchObject({ sessionId: 'temporary-session', resumable: true })
    expect(firstResponse.messages[0]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'temporary-e2e' } } })
    expect(service.observedMcpAuthorization).toEqual(['Bearer access-1'])

    await controller.beginOAuth(config)
    expect(openedUrls).toHaveLength(1)
    expect(service.refreshCount).toBe(1)
    expect(service.observedTokenBodies.at(-1)?.get('grant_type')).toBe('refresh_token')
    expect(service.observedTokenBodies.at(-1)?.get('refresh_token')).toBe('refresh-1')

    const refreshedClient = await controller.createHttpService(config)
    await refreshedClient.call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(service.observedMcpAuthorization.at(-1)).toBe('Bearer access-2')
    expect(service.observedOAuthRequestInit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ redirect: 'error', credentials: 'omit', cache: 'no-store' }),
      ])
    )
  })
})
