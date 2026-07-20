import { describe, expect, it, vi } from 'vitest'
import { assertSafeMcpEndpoint, consumeMcpPkceCallback, createMcpPkceAuthorization, McpHttpService } from './mcp-http-service'

describe('mobile MCP HTTP service', () => {
  it('requires HTTPS and blocks private endpoints and secrets in query strings', () => {
    expect(() => assertSafeMcpEndpoint('http://example.com/mcp')).toThrow('mcp_https_required')
    expect(() => assertSafeMcpEndpoint('https://127.0.0.1/mcp')).toThrow('mcp_private_endpoint_blocked')
    expect(() => assertSafeMcpEndpoint('https://example.com/mcp?api_key=secret')).toThrow('mcp_secret_query_forbidden')
    expect(assertSafeMcpEndpoint('https://192.168.1.5/mcp', { allowLan: true }).hostname).toBe('192.168.1.5')
  })

  it('tracks a resumable session and parses bounded SSE responses', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1' },
      })
    )
    const service = new McpHttpService({ endpoint: 'https://mcp.example.com', fetchImpl: fetchImpl as typeof fetch })
    const first = await service.call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(first.sessionId).toBe('session-1')
    expect(first.messages).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }])
    await service.call({ jsonrpc: '2.0', id: 2, method: 'resources/list' })
    const calls = fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>
    expect(calls[1]?.[1]?.headers).toMatchObject({ 'Mcp-Session-Id': 'session-1' })
  })

  it('binds PKCE callbacks to one stored state', async () => {
    const values = new Map<string, { verifier: string; redirectUri: string; expiresAt: number }>()
    const store = {
      set: async (state: string, value: { verifier: string; redirectUri: string; expiresAt: number }) => {
        values.set(state, value)
      },
      take: async (state: string) => {
        const value = values.get(state) || null
        values.delete(state)
        return value
      },
    }
    const authorization = await createMcpPkceAuthorization({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'mobile-client',
      redirectUri: 'yachiyoclaw://oauth/mcp',
      scopes: ['mcp'],
      store,
      now: 1_000,
    })
    const result = await consumeMcpPkceCallback({
      callbackUrl: `yachiyoclaw://oauth/mcp?code=code-1&state=${authorization.state}`,
      store,
      now: 2_000,
    })
    expect(result.code).toBe('code-1')
    expect(result.verifier.length).toBeGreaterThan(40)
    await expect(
      consumeMcpPkceCallback({
        callbackUrl: `yachiyoclaw://oauth/mcp?code=code-2&state=${authorization.state}`,
        store,
        now: 2_000,
      })
    ).rejects.toThrow('mcp_oauth_state_invalid')
  })
})
