import { describe, expect, it } from 'vitest'
import { assertMobileMCPServerConfig, validateMobileMCPServerConfig } from './mcp'

const validConfig = {
  id: 'docs',
  name: 'Docs',
  enabled: true,
  transport: {
    type: 'http' as const,
    url: 'https://mcp.example.test/session',
    protocol: 'streamable-http' as const,
    secretRefs: [{ id: 'docs-token', kind: 'oauth-access-token' as const, label: 'Docs token' }],
  },
}

describe('mobile MCP configuration contract', () => {
  it('accepts HTTPS Streamable HTTP with secret references and defaults refs', () => {
    const result = validateMobileMCPServerConfig(validConfig)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.transport.secretRefs[0].id).toBe('docs-token')

    const withoutRefs = validateMobileMCPServerConfig({
      ...validConfig,
      transport: { ...validConfig.transport, secretRefs: undefined },
    })
    expect(withoutRefs.success).toBe(true)
    if (withoutRefs.success) expect(withoutRefs.data.transport.secretRefs).toEqual([])
  })

  it('rejects stdio, HTTP, inline headers, and credential-bearing URLs', () => {
    expect(
      validateMobileMCPServerConfig({ ...validConfig, transport: { type: 'stdio', command: 'node', args: [] } })
    ).toMatchObject({
      success: false,
      issues: [{ code: 'stdio_unsupported' }],
    })
    expect(
      validateMobileMCPServerConfig({
        ...validConfig,
        transport: { ...validConfig.transport, url: 'http://mcp.example.test' },
      })
    ).toMatchObject({
      success: false,
      issues: [{ code: 'https_required' }],
    })
    expect(
      validateMobileMCPServerConfig({
        ...validConfig,
        transport: { ...validConfig.transport, headers: { Authorization: 'Bearer secret' } },
      })
    ).toMatchObject({
      success: false,
      issues: [{ code: 'raw_credentials' }],
    })
    expect(
      validateMobileMCPServerConfig({
        ...validConfig,
        transport: { ...validConfig.transport, url: 'https://mcp.example.test?token=secret' },
      })
    ).toMatchObject({
      success: false,
      issues: [{ code: 'raw_credentials' }],
    })
  })

  it('rejects duplicate references and never exposes a raw secret value', () => {
    const result = validateMobileMCPServerConfig({
      ...validConfig,
      transport: {
        ...validConfig.transport,
        secretRefs: [
          { id: 'same', kind: 'header', headerName: 'X-Token' },
          { id: 'same', kind: 'header', headerName: 'X-Other' },
        ],
      },
    })
    expect(result).toMatchObject({ success: false, issues: [{ code: 'duplicate_secret_ref' }] })
    expect(JSON.stringify(validConfig)).not.toContain('secret-value')
    expect(() => assertMobileMCPServerConfig(validConfig)).not.toThrow()
  })

  it('blocks private-network hosts unless LAN access was explicitly granted', () => {
    const lanConfig = { ...validConfig, transport: { ...validConfig.transport, url: 'https://192.168.1.20/mcp' } }
    expect(validateMobileMCPServerConfig(lanConfig)).toMatchObject({
      success: false,
      issues: [{ code: 'private_network_blocked' }],
    })
    expect(validateMobileMCPServerConfig(lanConfig, { allowLan: true }).success).toBe(true)
  })
})

