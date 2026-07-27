import type { SkillSignature } from '../types/skills'
import trustedSigners from './trusted-marketplace-signers.json'

interface TrustedMarketplaceSigner {
  keyId: string
  algorithm: SkillSignature['algorithm']
  publicKey: string
}

const OFFICIAL_MARKETPLACE_SIGNERS = trustedSigners.signers as TrustedMarketplaceSigner[]

/** Trust roots ship inside the signed app; a remote catalog cannot add or replace them. */
export function isTrustedMarketplaceSignature(signature: SkillSignature | undefined): boolean {
  if (!signature?.keyId || !signature.publicKey) return false
  return OFFICIAL_MARKETPLACE_SIGNERS.some(
    (signer) =>
      signer.keyId === signature.keyId &&
      signer.algorithm === signature.algorithm &&
      signer.publicKey === signature.publicKey,
  )
}

export function trustedMarketplaceSignerKeyIds(): string[] {
  return OFFICIAL_MARKETPLACE_SIGNERS.map((signer) => signer.keyId)
}
