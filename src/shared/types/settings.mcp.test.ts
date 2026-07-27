import { describe, expect, it } from 'vitest'
import { settings as defaultSettings } from '../defaults'
import { SettingsSchema } from './settings'

describe('persisted MCP settings schema', () => {
  it('preserves mobile OAuth, secure references, protocol, and manifest metadata', () => {
    const settings = SettingsSchema.parse({
      ...defaultSettings(),
      mcp: {
        enabledBuiltinServers: [],
        servers: [
          {
            id: 'remote-tools',
            name: 'Remote tools',
            enabled: true,
            transport: {
              type: 'http',
              url: 'https://mcp.example.com/v1',
              protocol: 'streamable-http',
              secretRefs: [{ id: 'mcp-token', kind: 'api-key', headerName: 'Authorization' }],
              oauth: {
                enabled: true,
                clientId: 'public-mobile-client',
                scopes: ['tools.read'],
                redirectUri: 'yachiyoclaw://oauth/mcp',
              },
            },
            manifest: {
              protocolVersion: '2025-06-18',
              capabilities: ['tools'],
              tools: [{ name: 'inspect', readOnly: true }],
            },
          },
        ],
      },
    })

    expect(settings.mcp.servers[0]).toMatchObject({
      transport: {
        protocol: 'streamable-http',
        secretRefs: [{ id: 'mcp-token', kind: 'api-key' }],
        oauth: { enabled: true, clientId: 'public-mobile-client' },
      },
      manifest: { protocolVersion: '2025-06-18', capabilities: ['tools'] },
    })
  })

  it('keeps legacy desktop stdio and header transports valid', () => {
    const settings = SettingsSchema.parse({
      ...defaultSettings(),
      mcp: {
        enabledBuiltinServers: [],
        servers: [
          { id: 'stdio', name: 'stdio', enabled: true, transport: { type: 'stdio', command: 'node', args: ['server.js'] } },
          {
            id: 'http',
            name: 'http',
            enabled: true,
            transport: { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Test': 'value' } },
          },
        ],
      },
    })
    expect(settings.mcp.servers).toHaveLength(2)
    expect(settings.mcp.servers[1].transport).toMatchObject({ type: 'http', headers: { 'X-Test': 'value' } })
  })
})
