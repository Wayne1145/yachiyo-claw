import type { MCPSecretRefValue } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import {
  consumePendingMcpOAuthCallback,
  createSafeMcpOAuthFetch,
  MobileMcpOAuthProvider,
  type McpOAuthStorage,
  type McpOAuthVault,
} from './mcp-oauth-provider'

function makeStorage(): McpOAuthStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function makeVault(): McpOAuthVault & { values: Map<string, string> } {
  const values = new Map<string, string>()
  const key = (ref: MCPSecretRefValue) => ref.id
  return {
    values,
    set: async (ref, value) => void values.set(key(ref), value),
    get: async (ref) => values.get(key(ref)) || null,
    remove: async (ref) => void values.delete(key(ref)),
  }
}

const config = {
  id: 'docs-server',
  name: 'Docs',
  enabled: true,
  transport: {
    type: 'http' as const,
    url: 'https://mcp.example.test/mcp',
    secretRefs: [],
    oauth: {
      enabled: true,
      clientId: 'mobile-client',
      scopes: ['mcp:tools'],
      redirectUri: 'yachiyoclaw://oauth/mcp' as const,
    },
  },
}

describe('MobileMcpOAuthProvider', () => {
  it('persists PKCE state for one bounded callback and keeps tokens in the vault', async () => {
    const storage = makeStorage()
    const vault = makeVault()
    const provider = new MobileMcpOAuthProvider({
      config,
      storage,
      vault,
      protect: async (value) => `protected:${value}`,
      now: () => 1_000,
      openExternal: vi.fn(async () => undefined),
    })

    const state = await provider.state()
    await expect(provider.state()).rejects.toThrow('mcp_oauth_already_pending')
    await provider.saveCodeVerifier('verifier-value')
    await provider.saveTokens({ access_token: 'access-value', token_type: 'Bearer', refresh_token: 'refresh-value' })

    expect(await provider.codeVerifier()).toBe('verifier-value')
    expect(await provider.tokens()).toMatchObject({ access_token: 'access-value', refresh_token: 'refresh-value' })
    expect(JSON.stringify([...storage.values.values()])).not.toContain('access-value')

    const callback = await consumePendingMcpOAuthCallback({
      callbackUrl: `yachiyoclaw://oauth/mcp?code=code-value&state=${state}`,
      storage,
      unprotect: async (value) => value.replace(/^protected:/, ''),
      now: 2_000,
    })
    expect(callback).toEqual({ serverId: 'docs-server', code: 'code-value' })
    await expect(provider.state()).resolves.toEqual(expect.any(String))
    await expect(
      consumePendingMcpOAuthCallback({
        callbackUrl: `yachiyoclaw://oauth/mcp?code=again&state=${state}`,
        storage,
        unprotect: async (value) => value,
      })
    ).rejects.toThrow('mcp_oauth_state_invalid')
  })

  it('uses a public client by default and removes selected credentials', async () => {
    const provider = new MobileMcpOAuthProvider({
      config,
      storage: makeStorage(),
      vault: makeVault(),
      protect: async (value) => value,
      openExternal: vi.fn(async () => undefined),
    })
    expect(await provider.clientInformation()).toEqual({ client_id: 'mobile-client' })
    expect(provider.clientMetadata).toMatchObject({ token_endpoint_auth_method: 'none' })
    await provider.saveTokens({ access_token: 'token', token_type: 'Bearer' })
    await provider.invalidateCredentials('tokens')
    expect(await provider.tokens()).toBeUndefined()
  })

  it('blocks unsafe OAuth fetch endpoints and disables redirects', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
      return new Response('{}')
    })
    const safeFetch = createSafeMcpOAuthFetch(fetchImpl as typeof fetch)
    await safeFetch('https://auth.example.test/token', { method: 'POST' })
    await expect(safeFetch('http://auth.example.test/token')).rejects.toThrow('mcp_https_required')
  })
})
