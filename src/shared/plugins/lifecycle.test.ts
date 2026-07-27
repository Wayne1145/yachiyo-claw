import { describe, expect, it } from 'vitest'
import { parsePluginManifest, type PluginManifest } from './manifest'
import {
  EMPTY_HEALTH,
  evaluateGrantPreservation,
  HEALTH_AUTO_DISABLE_THRESHOLD,
  isPluginCompatible,
  recordPluginFailure,
  recordPluginSuccess,
  reenablePlugin,
} from './lifecycle'

function manifest(capabilities: unknown[], version = '1.0.0'): PluginManifest {
  return parsePluginManifest({
    schemaVersion: 1,
    id: 'demo',
    version,
    displayName: 'Demo',
    description: 'A plugin used for lifecycle tests.',
    capabilities,
    contributions: {},
    files: [{ path: 'README.md', size: 1, sha256: 'a'.repeat(64) }],
  })
}

const storage = { name: 'storage', reason: 'Keeps the plugin state across sessions.' }
const network = (domains: string[]) => ({ name: 'network', reason: 'Calls the weather API for forecasts.', domains })
const device = { name: 'device', reason: 'Automates a device flow for the user on request.' }

describe('evaluateGrantPreservation', () => {
  it('preserves grants for an unchanged capability set with the same signer', () => {
    const result = evaluateGrantPreservation({
      oldManifest: manifest([storage]),
      newManifest: manifest([storage], '1.1.0'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k1',
    })
    expect(result).toEqual({ storage: 'preserve' })
  })

  it('requires re-consent for newly added capabilities only', () => {
    const result = evaluateGrantPreservation({
      oldManifest: manifest([storage]),
      newManifest: manifest([storage, network(['api.example.com'])], '1.1.0'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k1',
    })
    expect(result).toEqual({ storage: 'preserve', network: 'reconsent' })
  })

  it('requires re-consent for everything when the signer changes', () => {
    const result = evaluateGrantPreservation({
      oldManifest: manifest([storage]),
      newManifest: manifest([storage], '1.1.0'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k2',
    })
    expect(result).toEqual({ storage: 'reconsent' })
  })

  it('requires re-consent when the network domain list widens, preserves when it shrinks', () => {
    const widened = evaluateGrantPreservation({
      oldManifest: manifest([network(['api.example.com'])]),
      newManifest: manifest([network(['api.example.com', 'evil.example.net'])], '1.1.0'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k1',
    })
    expect(widened.network).toBe('reconsent')
    const narrowed = evaluateGrantPreservation({
      oldManifest: manifest([network(['api.example.com', 'cdn.example.com'])]),
      newManifest: manifest([network(['api.example.com'])], '1.1.0'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k1',
    })
    expect(narrowed.network).toBe('preserve')
  })

  it('never carries grants across unsigned updates', () => {
    expect(
      evaluateGrantPreservation({ oldManifest: manifest([storage]), newManifest: manifest([storage], '1.1.0') }),
    ).toEqual({ storage: 'reconsent' })
  })

  it('invalidates device grants unconditionally', () => {
    const result = evaluateGrantPreservation({
      oldManifest: manifest([device]),
      newManifest: manifest([device], '1.0.1'),
      oldSignerKeyId: 'k1',
      newSignerKeyId: 'k1',
    })
    expect(result.device).toBe('reconsent')
  })
})

describe('isPluginCompatible', () => {
  it('gates on minAppVersion and fails closed on malformed versions', () => {
    expect(isPluginCompatible({ minAppVersion: '0.0.10' }, '0.0.11')).toBe(true)
    expect(isPluginCompatible({ minAppVersion: '0.0.12' }, '0.0.11')).toBe(false)
    expect(isPluginCompatible({ minAppVersion: undefined }, '0.0.11')).toBe(true)
    expect(isPluginCompatible({ minAppVersion: 'not-a-version' }, '0.0.11')).toBe(false)
  })
})

describe('plugin health', () => {
  it('auto-disables after consecutive failures and requires explicit re-enable', () => {
    let health = EMPTY_HEALTH
    for (let index = 0; index < HEALTH_AUTO_DISABLE_THRESHOLD; index++) {
      health = recordPluginFailure(health, index === 0 ? 'timeout' : 'error', `boom ${index}`)
    }
    expect(health.disabledReason).toBeTruthy()
    expect(health.totalTimeouts).toBe(1)
    // Success resets the streak but does NOT un-disable.
    health = recordPluginSuccess(health)
    expect(health.consecutiveFailures).toBe(0)
    expect(health.disabledReason).toBeTruthy()
    // Explicit user action clears it.
    health = reenablePlugin(health)
    expect(health.disabledReason).toBeUndefined()
  })

  it('a success between failures prevents auto-disable', () => {
    let health = recordPluginFailure(EMPTY_HEALTH, 'error', 'a')
    health = recordPluginFailure(health, 'error', 'b')
    health = recordPluginSuccess(health)
    health = recordPluginFailure(health, 'error', 'c')
    expect(health.disabledReason).toBeUndefined()
  })
})
