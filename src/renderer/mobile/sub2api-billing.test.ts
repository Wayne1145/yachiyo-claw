import { describe, expect, it } from 'vitest'
import { parseSub2ApiBilling, sub2ApiEndpoints } from './sub2api-billing'

describe('sub2api billing', () => {
  it('preserves v1 and reverse-proxy prefixes', () => {
    expect(sub2ApiEndpoints('https://api.test/proxy/v1/chat/completions').billing).toBe(
      'https://api.test/proxy/v1/sub2api/billing'
    )
    expect(sub2ApiEndpoints('https://api.test').usage).toBe('https://api.test/v1/usage')
  })
  it('does not send credentials over insecure remote endpoints', () => {
    expect(() => sub2ApiEndpoints('http://api.test')).toThrow('HTTPS')
    expect(() => sub2ApiEndpoints('https://key@api.test')).toThrow()
  })
  it('distinguishes balance from key quota and keeps unknown values unknown', () => {
    const result = parseSub2ApiBilling(
      { object: 'sub2api.key_billing', effective_rate_multiplier: 0.75 },
      { mode: 'quota_limited', remaining: 5 }
    )
    expect(result).toMatchObject({ multiplier: 0.75, balance: undefined, remaining: 5, scope: 'key-quota' })
    expect(parseSub2ApiBilling({}, {})).toMatchObject({ multiplier: undefined, balance: undefined })
  })
})
