import { describe, expect, it } from 'vitest'
import catalog from '../../../plugin-marketplace/index.json'
import { parsePluginMarketplaceCatalog } from './marketplace'
import { isTrustedMarketplaceSignature, trustedMarketplaceSignerKeyIds } from './marketplace-trust'

describe('official plugin marketplace trust roots', () => {
  it('trusts the bundled marketplace signer and rejects key substitution', () => {
    const signature = parsePluginMarketplaceCatalog(catalog).plugins[0].signature
    expect(isTrustedMarketplaceSignature(signature)).toBe(true)
    expect(trustedMarketplaceSignerKeyIds()).toContain(signature.keyId)
    expect(isTrustedMarketplaceSignature({ ...signature, publicKey: `${signature.publicKey}A` })).toBe(false)
    expect(isTrustedMarketplaceSignature({ ...signature, keyId: 'attacker-key' })).toBe(false)
  })
})
