import { describe, expect, it } from 'vitest'
import type { PluginMarketplaceEntry } from '@shared/plugins/marketplace'
import type { InstalledPluginRecord } from './installer'
import { describePluginUpdate, findMarketplacePluginUpdates, isNewerPluginVersion } from './plugin-updates'

function record(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'demo-plugin',
      displayName: 'Demo',
      description: 'A test plugin',
      version: '1.0.0',
      capabilities: [
        { name: 'storage', reason: 'Persist plugin settings safely' },
        { name: 'network', reason: 'Call the configured service API', domains: ['api.example.com'] },
      ],
      contributions: {},
      files: [{ path: 'main.js', size: 1, sha256: 'a'.repeat(64) }],
    },
    packageSha256: 'b'.repeat(64),
    signatureVerified: true,
    signerKeyId: 'publisher-one',
    deviceGrantAllowed: true,
    source: 'marketplace',
    installedAt: 1,
    ...overrides,
  }
}

describe('plugin update metadata', () => {
  it('reports added capabilities, expanded domains, removals, and signer changes', () => {
    const current = record()
    const candidate = {
      ...current.manifest,
      version: '2.0.0',
      capabilities: [
        { name: 'network' as const, reason: 'Call the configured service API', domains: ['api.example.com', 'cdn.example.com'] },
        { name: 'tools' as const, reason: 'Expose an explicit agent helper' },
      ],
    }
    expect(describePluginUpdate(current, candidate, 'publisher-two')).toEqual({
      capabilityChanges: { added: ['tools'], removed: ['storage'], expandedDomains: ['cdn.example.com'] },
      signerChanged: true,
    })
  })

  it('finds only newer marketplace entries without downloading packages', () => {
    const entry = {
      id: 'demo-plugin',
      name: 'Demo',
      description: 'A test plugin',
      version: '1.1.0',
    } as PluginMarketplaceEntry
    expect(findMarketplacePluginUpdates([record()], [entry]).get('demo-plugin')).toBe(entry)
    expect(findMarketplacePluginUpdates([record({ source: 'sideload' })], [entry])).toHaveLength(0)
    expect(isNewerPluginVersion('2.0.0', '1.0.0')).toBe(false)
  })
})
