import { describe, expect, it } from 'vitest'
import { mergeSharedOAuthProviderSettings, toOAuthProviderId, toOAuthSettingsProviderId } from './provider-mapping'

describe('provider-mapping', () => {
  it('maps openai-responses to the openai oauth provider', () => {
    expect(toOAuthProviderId('openai-responses')).toBe('openai')
    expect(toOAuthSettingsProviderId('openai-responses')).toBe('openai')
  })

  it('maps qwen-portal to its own oauth provider', () => {
    expect(toOAuthProviderId('qwen')).toBeUndefined()
    expect(toOAuthSettingsProviderId('qwen')).toBeUndefined()
    expect(toOAuthProviderId('qwen-portal')).toBe('qwen-portal')
    expect(toOAuthSettingsProviderId('qwen-portal')).toBe('qwen-portal')
  })

  it('merges shared oauth credentials from the mapped provider without overriding auth mode', () => {
    const merged = mergeSharedOAuthProviderSettings('openai-responses', {
      openai: {
        oauth: {
          accessToken: 'oauth-token',
          refreshToken: 'refresh-token',
          expiresAt: 123,
        },
        activeAuthMode: 'oauth',
      },
      'openai-responses': {
        apiPath: '/responses',
        activeAuthMode: 'apikey',
      },
    })

    expect(merged.apiPath).toBe('/responses')
    expect(merged.oauth?.accessToken).toBe('oauth-token')
    expect(merged.activeAuthMode).toBe('apikey')
  })
})
