import type { SkillSignature } from '../types/skills'
import { inspectArchiveEntries, sha256Hex, verifyPackageSignature } from '../skills/skillhub'
import { parsePluginManifest, type PluginManifest } from './manifest'
import { PLUGIN_MANIFEST_FILENAME, PLUGIN_PACKAGE_LIMITS } from './package'
import { canGrantPluginDeviceCapability } from './device-policy'
import { isTrustedMarketplaceSignature } from './marketplace-trust'
import { checkCodeWithinQuota } from './storage'

/**
 * Plugin package verification core (platform-27).
 *
 * The pure security pipeline the installer must run, in this exact order, before anything is written
 * to disk: whole-package digest → signature → archive-entry guard (shared `inspectArchiveEntries` —
 * the same implementation Skills uses, not a copy) → manifest parse → per-file digest comparison.
 * Sizes are taken from the actually-decoded bytes, never from container metadata (the JSZip
 * `_data.uncompressedSize` private field is a known fragility this module deliberately avoids).
 *
 * Trust tiers: a marketplace package MUST verify against a trust root bundled with the signed app;
 * any https package may be unsigned but is marked, and sideloads are unsigned by definition. Device
 * eligibility additionally requires a trusted marketplace signature; installation still leaves the
 * capability denied until a separate explicit grant, and every mutating call passes through the
 * principal-bound Tool Broker bridge.
 */

export type PluginInstallErrorCode = 'integrity' | 'signature' | 'archive' | 'manifest' | 'files'

export class PluginInstallError extends Error {
  constructor(
    message: string,
    public readonly code: PluginInstallErrorCode,
  ) {
    super(message)
    this.name = 'PluginInstallError'
  }
}

export interface DecodedPackageFile {
  path: string
  bytes: Uint8Array
  type?: 'file' | 'directory' | 'symlink'
}

export type PluginSource = 'marketplace' | 'https' | 'sideload'

export interface VerifiedPluginPackage {
  manifest: PluginManifest
  packageSha256: string
  signatureVerified: boolean
  /** Verified signer identity, never copied from the untrusted manifest. */
  signerKeyId?: string
  /** True only after both signature trust and the complete Tool Broker principal bridge exist. */
  deviceGrantAllowed: boolean
  source: PluginSource
  unpackedBytes: number
  /** Path → verified content, ready to be written to a staging directory. */
  files: Map<string, Uint8Array>
}

export interface VerifyPluginPackageInput {
  /** The raw package bytes, for whole-package digest + signature. */
  packageBytes: ArrayBuffer | Uint8Array
  /** Decoded entries. Sizes are derived from `bytes.byteLength` here, not trusted from the container. */
  files: DecodedPackageFile[]
  source: PluginSource
  expectedSha256?: string
  signature?: SkillSignature
  appVersion?: string
}

export async function verifyPluginPackage(input: VerifyPluginPackageInput): Promise<VerifiedPluginPackage> {
  // 1. Whole-package digest.
  const packageSha256 = await sha256Hex(input.packageBytes)
  const expected = input.expectedSha256?.toLowerCase()
  if (expected && packageSha256 !== expected) {
    throw new PluginInstallError('Plugin package hash does not match its expected digest.', 'integrity')
  }

  // 2. Signature. Marketplace packages must carry one and it must verify; elsewhere a present
  //    signature must verify, and absence just marks the package unsigned.
  let signatureVerified = false
  let signerKeyId: string | undefined
  const marketplaceSignerTrusted =
    input.source === 'marketplace' && isTrustedMarketplaceSignature(input.signature)
  if (input.source === 'marketplace' && input.signature && !marketplaceSignerTrusted) {
    throw new PluginInstallError('Marketplace plugin signer is not trusted by this app version.', 'signature')
  }
  if (input.signature) {
    if (!(await verifyPackageSignature(input.packageBytes, input.signature))) {
      throw new PluginInstallError('Plugin package signature verification failed.', 'signature')
    }
    signatureVerified = true
    if (input.signature.publicKey) {
      const fingerprint = await sha256Hex(new TextEncoder().encode(input.signature.publicKey))
      signerKeyId = input.signature.keyId ? `${input.signature.keyId}:${fingerprint}` : fingerprint
    }
  }
  if (input.source === 'marketplace' && !signatureVerified) {
    throw new PluginInstallError('Marketplace plugins must be signed.', 'signature')
  }

  // 3. Archive-entry guard (traversal / absolute / drive letter / backslash / symlink / duplicates /
  //    counts / total size) — shared with Skills, sizes from decoded bytes.
  const entries = input.files.map((file) => ({
    path: file.path,
    size: file.type === 'file' || file.type === undefined ? file.bytes.byteLength : 0,
    type: file.type,
  }))
  try {
    inspectArchiveEntries(entries, {
      maxFiles: PLUGIN_PACKAGE_LIMITS.maxFiles,
      maxTotalBytes: PLUGIN_PACKAGE_LIMITS.maxTotalUnpackedBytes,
      label: 'Plugin package',
    })
  } catch (error) {
    throw new PluginInstallError(error instanceof Error ? error.message : 'Unsafe plugin archive.', 'archive')
  }

  const contents = new Map<string, Uint8Array>()
  for (const file of input.files) {
    if (file.type === 'directory' || file.type === 'symlink') continue
    contents.set(file.path.replace(/\\/g, '/'), file.bytes)
  }
  const unpackedBytes = [...contents.values()].reduce((total, bytes) => total + bytes.byteLength, 0)
  const codeQuota = checkCodeWithinQuota(unpackedBytes)
  if (!codeQuota.ok) throw new PluginInstallError(codeQuota.reason, 'files')

  // 4. Manifest at the package root.
  const manifestBytes = contents.get(PLUGIN_MANIFEST_FILENAME)
  if (!manifestBytes) {
    throw new PluginInstallError(`Plugin package must contain ${PLUGIN_MANIFEST_FILENAME} at its root.`, 'manifest')
  }
  let manifest: PluginManifest
  try {
    manifest = parsePluginManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), {
      appVersion: input.appVersion,
    })
  } catch (error) {
    throw new PluginInstallError(error instanceof Error ? error.message : 'Invalid plugin manifest.', 'manifest')
  }

  // 5. Per-file digest comparison, bidirectional: every declared file must exist with matching size
  //    and digest, and every packaged file must be declared — an undeclared file would land on disk
  //    without ever having been verified.
  const declaredPaths = new Set<string>(manifest.files.map((file) => file.path))
  declaredPaths.add(PLUGIN_MANIFEST_FILENAME)
  for (const file of manifest.files) {
    if (file.path === PLUGIN_MANIFEST_FILENAME) continue
    const bytes = contents.get(file.path)
    if (!bytes) throw new PluginInstallError(`Declared file "${file.path}" is missing from the package.`, 'files')
    if (bytes.byteLength !== file.size) {
      throw new PluginInstallError(`File "${file.path}" size does not match its manifest entry.`, 'files')
    }
    if (!file.sha256 || (await sha256Hex(bytes)) !== file.sha256.toLowerCase()) {
      throw new PluginInstallError(`File "${file.path}" digest does not match its manifest entry.`, 'files')
    }
  }
  for (const path of contents.keys()) {
    if (!declaredPaths.has(path)) {
      throw new PluginInstallError(`Package contains undeclared file "${path}".`, 'files')
    }
  }

  // 6. Entry digest against the actual bytes (the manifest already cross-checks entrySha256 against
  //    files[]; this closes the loop against the content itself) + entry size bound.
  if (manifest.entry && manifest.entrySha256) {
    const entryBytes = contents.get(manifest.entry)
    if (!entryBytes) throw new PluginInstallError(`Entry "${manifest.entry}" is missing from the package.`, 'files')
    if (entryBytes.byteLength > PLUGIN_PACKAGE_LIMITS.maxEntryBytes) {
      throw new PluginInstallError('Plugin entry script exceeds the size limit.', 'files')
    }
    if ((await sha256Hex(entryBytes)) !== manifest.entrySha256.toLowerCase()) {
      throw new PluginInstallError('Entry script content does not match entrySha256.', 'files')
    }
  }

  return {
    manifest,
    packageSha256,
    signatureVerified,
    signerKeyId,
    deviceGrantAllowed: canGrantPluginDeviceCapability(signatureVerified && marketplaceSignerTrusted),
    source: input.source,
    unpackedBytes,
    files: contents,
  }
}
