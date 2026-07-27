import { describe, expect, it } from 'vitest'
import { validateMobileMCPServerConfig } from '@shared/types/mcp'
import { getConfigFromFormValues } from './utils'

describe('mobile MCP form serialization', () => {
  it('omits empty desktop credential fields from a remote server config', () => {
    const config = getConfigFromFormValues({
      id: 'deepwiki',
      name: 'DeepWiki',
      enabled: true,
      transport: {
        type: 'http',
        url: 'https://mcp.deepwiki.com/mcp',
        headers: undefined,
        secretRefs: undefined,
        protocol: undefined,
        oauthEnabled: false,
      },
    })

    expect(config.transport).toEqual({
      type: 'http',
      url: 'https://mcp.deepwiki.com/mcp',
    })
    expect(validateMobileMCPServerConfig(config).success).toBe(true)
  })
})
