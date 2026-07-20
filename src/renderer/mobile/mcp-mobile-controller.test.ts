import type { MCPSecretRefValue } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { type MobileMcpConfigStorage, MobileMcpController, type MobileMcpSecretVault } from './mcp-mobile-controller'

function makeStorage(): MobileMcpConfigStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function makeVault(): MobileMcpSecretVault & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    set: vi.fn(async (ref: MCPSecretRefValue, value: string) => void values.set(ref.id, `encrypted:${value}`)),
    get: vi.fn(async (ref: MCPSecretRefValue) => values.get(ref.id)?.replace(/^encrypted:/, '') || null),
    remove: vi.fn(async (ref: MCPSecretRefValue) => void values.delete(ref.id)),
  }
}

const config = {
  id: 'docs',
  name: 'Docs',
  enabled: true,
  transport: {
    type: 'http' as const,
    url: 'https://mcp.example.test',
    secretRefs: [{ id: 'token', kind: 'oauth-access-token' as const }],
  },
}

describe('MobileMcpController', () => {
  it('persists only validated server metadata and rejects stdio', () => {
    const storage = makeStorage()
    const controller = new MobileMcpController({ storage, vault: makeVault(), isNativePlatform: () => true })
    expect(controller.upsert(config)).toMatchObject({ id: 'docs' })
    expect(controller.list()).toHaveLength(1)
    expect(JSON.stringify(storage.getItem('yachiyo.mobile.mcp.servers.v1'))).not.toContain('secret-value')
    expect(() => controller.upsert({ ...config, transport: { type: 'stdio', command: 'node', args: [] } })).toThrow(
      'stdio MCP transports'
    )
  })

  it('stores and resolves secret references ephemerally', async () => {
    const vault = makeVault()
    const controller = new MobileMcpController({ storage: makeStorage(), vault, isNativePlatform: () => true })
    await controller.saveSecret(config.transport.secretRefs[0], 'token-value')
    await controller.upsert(config)
    await expect(controller.resolveHeaders(config)).resolves.toEqual({ Authorization: 'Bearer token-value' })
    expect(vault.set).toHaveBeenCalledOnce()
    expect(vault.values.get('token')).toBe('encrypted:token-value')
  })

  it('reports and filters invalid persisted configurations', () => {
    const storage = makeStorage()
    storage.setItem(
      'yachiyo.mobile.mcp.servers.v1',
      JSON.stringify([config, { ...config, id: 'bad', transport: { type: 'stdio', command: 'node', args: [] } }])
    )
    const controller = new MobileMcpController({ storage, vault: makeVault(), isNativePlatform: () => true })
    const result = controller.listWithIssues()
    expect(result.servers.map((server) => server.id)).toEqual(['docs'])
    expect(result.rejected[0].issues[0].code).toBe('stdio_unsupported')
  })
})
