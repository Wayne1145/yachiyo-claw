import { describe, expect, it } from 'vitest'
import { parsePluginMarketplaceCatalog } from './marketplace'

describe('plugin marketplace catalog', () => {
  it('requires signed, hash-pinned HTTPS packages', () => {
    const entry = {
      id: 'demo',
      name: 'Demo',
      description: 'A signed demo plugin.',
      version: '1.0.0',
      packageUrl: 'https://cdn.example.com/demo.zip',
      packageSize: 1024,
      sha256: 'a'.repeat(64),
      signature: { algorithm: 'ed25519', value: 'c2ln', publicKey: 'a2V5' },
    }
    expect(parsePluginMarketplaceCatalog({ schemaVersion: 1, plugins: [entry] }).plugins[0].id).toBe('demo')
    expect(() =>
      parsePluginMarketplaceCatalog({ schemaVersion: 1, plugins: [{ ...entry, packageUrl: 'http://example.com/x' }] }),
    ).toThrow()
    expect(() =>
      parsePluginMarketplaceCatalog({ schemaVersion: 1, plugins: [{ ...entry, signature: undefined }] }),
    ).toThrow()
  })
})
