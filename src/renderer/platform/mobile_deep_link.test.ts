import { afterEach, describe, expect, it } from 'vitest'
import { acceptMobileDeepLink, consumePendingProviderImport, MOBILE_PROVIDER_IMPORT_PATH } from './mobile_deep_link'

describe('mobile provider import deep links', () => {
  afterEach(() => {
    consumePendingProviderImport()
  })

  it('keeps provider credentials out of the navigation path and consumes them once', () => {
    const apiKey = 'sk-sensitive-mobile-key'
    const encodedConfig = btoa(JSON.stringify({ id: 'openai', apiKey }))
    const result = acceptMobileDeepLink(`yachiyoclaw://provider/import?config=${encodeURIComponent(encodedConfig)}`)

    expect(result).toEqual({ kind: 'navigate', path: MOBILE_PROVIDER_IMPORT_PATH })
    expect(result.kind === 'navigate' ? result.path : '').not.toContain(apiKey)
    expect(result.kind === 'navigate' ? result.path : '').not.toContain(encodedConfig)
    expect(consumePendingProviderImport()).toBe(encodedConfig)
    expect(consumePendingProviderImport()).toBeNull()
  })

  it('accepts the development scheme without exposing its configuration', () => {
    const encodedConfig = btoa(JSON.stringify({ id: 'openai', apiKey: 'dev-secret' }))

    expect(
      acceptMobileDeepLink(`yachiyoclaw-dev://provider/import?config=${encodeURIComponent(encodedConfig)}`)
    ).toEqual({ kind: 'navigate', path: MOBILE_PROVIDER_IMPORT_PATH })
    expect(consumePendingProviderImport()).toBe(encodedConfig)
  })

  it('rejects unsupported and malformed links with fixed reason codes', () => {
    expect(acceptMobileDeepLink('https://example.com/?apiKey=secret')).toEqual({
      kind: 'rejected',
      reason: 'unsupported-scheme',
    })
    expect(acceptMobileDeepLink('not a URL containing sk-secret')).toEqual({
      kind: 'rejected',
      reason: 'invalid-url',
    })
    expect(consumePendingProviderImport()).toBeNull()
  })

  it('handles auth callbacks without retaining their query credentials', () => {
    expect(acceptMobileDeepLink('yachiyoclaw://auth/callback?ticket_id=sensitive-ticket')).toEqual({
      kind: 'handled',
    })
    expect(consumePendingProviderImport()).toBeNull()
  })
})
