import { describe, expect, it } from 'vitest'
import { evaluatePluginGrant, type PluginGrant, PluginGrantSchema, shouldSuppressPrompt } from './grants'

const SHA = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function grant(over: Partial<PluginGrant> = {}): PluginGrant {
  return {
    schemaVersion: 1,
    pluginId: 'weather',
    capability: 'storage',
    state: 'granted',
    boundEntrySha256: SHA,
    decidedAt: 1000,
    expiresAt: null,
    ...over,
  }
}

describe('PluginGrantSchema', () => {
  it('validates a well-formed grant and rejects unknown fields', () => {
    expect(() => PluginGrantSchema.parse(grant())).not.toThrow()
    expect(() => PluginGrantSchema.parse({ ...grant(), rogue: 1 })).toThrow()
  })
})

describe('evaluatePluginGrant (default-deny)', () => {
  const context = { capability: 'storage' as const, currentEntrySha256: SHA, now: 5000 }

  it('denies a missing grant', () => {
    expect(evaluatePluginGrant(null, context)).toEqual({ allowed: false, reason: 'no_grant' })
    expect(evaluatePluginGrant(undefined, context)).toEqual({ allowed: false, reason: 'no_grant' })
  })
  it('allows a matching granted, unexpired, code-bound grant', () => {
    expect(evaluatePluginGrant(grant(), context)).toEqual({ allowed: true })
    expect(evaluatePluginGrant(grant(), { ...context, pluginId: 'other' })).toEqual({
      allowed: false,
      reason: 'plugin_mismatch',
    })
  })
  it('denies a capability mismatch', () => {
    expect(evaluatePluginGrant(grant({ capability: 'network', domains: ['x.com'] }), context).allowed).toBe(false)
  })
  it('respects a denied grant', () => {
    expect(evaluatePluginGrant(grant({ state: 'denied' }), context)).toEqual({ allowed: false, reason: 'not_granted' })
    expect(evaluatePluginGrant(grant({ state: 'revoked' }), context)).toEqual({ allowed: false, reason: 'not_granted' })
  })
  it('forces re-consent when the plugin code digest changed', () => {
    expect(evaluatePluginGrant(grant(), { ...context, currentEntrySha256: OTHER })).toEqual({
      allowed: false,
      reason: 're_consent_required',
    })
  })
  it('denies an expired grant', () => {
    expect(evaluatePluginGrant(grant({ expiresAt: 4000 }), context)).toEqual({ allowed: false, reason: 'expired' })
    expect(evaluatePluginGrant(grant({ expiresAt: 6000 }), context).allowed).toBe(true)
  })
  it('enforces the network domain allow-list', () => {
    const net = grant({ capability: 'network', domains: ['api.example.com'] })
    const netContext = { capability: 'network' as const, currentEntrySha256: SHA, now: 5000 }
    expect(evaluatePluginGrant(net, { ...netContext, host: 'api.example.com' })).toEqual({ allowed: true })
    expect(evaluatePluginGrant(net, { ...netContext, host: 'evil.com' })).toEqual({
      allowed: false,
      reason: 'domain_not_allowed',
    })
    expect(evaluatePluginGrant(net, netContext)).toEqual({ allowed: false, reason: 'host_required' })
  })
})

describe('shouldSuppressPrompt', () => {
  it('suppresses re-prompt for a denial, and for a grant only while code is unchanged', () => {
    expect(shouldSuppressPrompt(grant({ state: 'denied' }), OTHER)).toBe(true) // denial stands across updates
    expect(shouldSuppressPrompt(grant(), SHA)).toBe(true)
    expect(shouldSuppressPrompt(grant(), OTHER)).toBe(false) // code changed -> ask again
    expect(shouldSuppressPrompt(null, SHA)).toBe(false)
  })
})
