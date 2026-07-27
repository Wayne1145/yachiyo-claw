import { describe, expect, it } from 'vitest'
import { sha256Hex, verifyEcdsaP256Signature } from '../skills/skillhub'
import { PLUGIN_PACKAGE_LIMITS } from './package'
import { PLUGIN_STORAGE_LIMITS } from './storage'
import { type DecodedPackageFile, PluginInstallError, verifyPluginPackage } from './verify'

const text = (value: string) => new TextEncoder().encode(value)

async function makePackage(over: { manifest?: Record<string, unknown>; files?: DecodedPackageFile[] } = {}) {
  const entryBytes = text('yachiyo.registerTool("demo_echo", function(a){return a});')
  const entrySha = await sha256Hex(entryBytes)
  const manifest = {
    schemaVersion: 1,
    id: 'demo',
    version: '1.0.0',
    displayName: 'Demo',
    description: 'A demo plugin used by the verification tests.',
    entry: 'main.js',
    entrySha256: entrySha,
    capabilities: [{ name: 'tools', reason: 'Contributes the demo_echo tool to the agent.' }],
    contributions: { tools: [{ name: 'demo_echo', description: 'Echoes its arguments back.' }] },
    files: [{ path: 'main.js', size: entryBytes.byteLength, sha256: entrySha }],
    ...over.manifest,
  }
  const manifestBytes = text(JSON.stringify(manifest))
  const files: DecodedPackageFile[] = over.files ?? [
    { path: 'yachiyo-plugin.json', bytes: manifestBytes },
    { path: 'main.js', bytes: entryBytes },
  ]
  // packageBytes stands in for the raw zip; digest/signature are computed over it.
  const packageBytes = text(JSON.stringify({ files: files.map((f) => f.path) }))
  return { manifest, manifestBytes, entryBytes, entrySha, files, packageBytes }
}

describe('verifyPluginPackage', () => {
  it('verifies a well-formed unsigned https package and forbids device grants', async () => {
    const pkg = await makePackage()
    const result = await verifyPluginPackage({ packageBytes: pkg.packageBytes, files: pkg.files, source: 'https' })
    expect(result.manifest.id).toBe('demo')
    expect(result.signatureVerified).toBe(false)
    expect(result.deviceGrantAllowed).toBe(false)
    expect(result.files.has('main.js')).toBe(true)
  })

  it('rejects a whole-package digest mismatch', async () => {
    const pkg = await makePackage()
    await expect(
      verifyPluginPackage({
        packageBytes: pkg.packageBytes,
        files: pkg.files,
        source: 'https',
        expectedSha256: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'integrity' })
  })

  it('verifies a real ECDSA P-256 signature and derives signer identity from the public key', async () => {
    const pkg = await makePackage()
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
    const rawSignature = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, pkg.packageBytes),
    )
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    const signature = { algorithm: 'ecdsa-p256' as const, value: b64(rawSignature), publicKey: b64(spki) }

    // Sanity: the shared primitive verifies.
    expect(await verifyEcdsaP256Signature(pkg.packageBytes, signature.value, signature.publicKey)).toBe(true)

    const result = await verifyPluginPackage({
      packageBytes: pkg.packageBytes,
      files: pkg.files,
      source: 'https',
      signature,
    })
    expect(result.signatureVerified).toBe(true)
    expect(result.signerKeyId).toBe(await sha256Hex(new TextEncoder().encode(signature.publicKey)))
    // A self-signed HTTPS package is cryptographically valid but is not an official trust root.
    expect(result.deviceGrantAllowed).toBe(false)

    // Tampered bytes -> signature failure.
    await expect(
      verifyPluginPackage({ packageBytes: text('tampered'), files: pkg.files, source: 'https', signature }),
    ).rejects.toMatchObject({ code: 'signature' })
  })

  it('rejects a self-signed marketplace package whose signer is not pinned in the app', async () => {
    const pkg = await makePackage()
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
    const value = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, pkg.packageBytes),
    )
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

    await expect(
      verifyPluginPackage({
        packageBytes: pkg.packageBytes,
        files: pkg.files,
        source: 'marketplace',
        signature: {
          algorithm: 'ecdsa-p256',
          keyId: 'attacker-key',
          publicKey: b64(publicKey),
          value: b64(value),
        },
      }),
    ).rejects.toMatchObject({ code: 'signature' })
  })

  it('rejects an unsigned marketplace package', async () => {
    const pkg = await makePackage()
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: pkg.files, source: 'marketplace' }),
    ).rejects.toMatchObject({ code: 'signature' })
  })

  it('rejects traversal, absolute, drive-letter, and symlink entries', async () => {
    const pkg = await makePackage()
    for (const bad of [
      { path: '../evil.js', bytes: text('x') },
      { path: '/abs.js', bytes: text('x') },
      { path: 'C:evil.js', bytes: text('x') },
      { path: 'link.js', bytes: text('x'), type: 'symlink' as const },
    ]) {
      await expect(
        verifyPluginPackage({ packageBytes: pkg.packageBytes, files: [...pkg.files, bad], source: 'https' }),
      ).rejects.toMatchObject({ code: 'archive' })
    }
  })

  it('rejects file-count and total-size overruns', async () => {
    const pkg = await makePackage()
    const many: DecodedPackageFile[] = Array.from({ length: PLUGIN_PACKAGE_LIMITS.maxFiles + 1 }, (_, index) => ({
      path: `assets/file-${index}.json`,
      bytes: text('{}'),
    }))
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: many, source: 'https' }),
    ).rejects.toMatchObject({
      code: 'archive',
    })

    const huge: DecodedPackageFile = {
      path: 'assets/huge.bin',
      bytes: new Uint8Array(PLUGIN_PACKAGE_LIMITS.maxTotalUnpackedBytes + 1),
    }
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: [...pkg.files, huge], source: 'https' }),
    ).rejects.toMatchObject({ code: 'archive' })
  })

  it('rejects a missing manifest, a malformed manifest, and reuses manifest cross-validation', async () => {
    const pkg = await makePackage()
    await expect(
      verifyPluginPackage({
        packageBytes: pkg.packageBytes,
        files: [{ path: 'main.js', bytes: pkg.entryBytes }],
        source: 'https',
      }),
    ).rejects.toMatchObject({ code: 'manifest' })
    await expect(
      verifyPluginPackage({
        packageBytes: pkg.packageBytes,
        files: [{ path: 'yachiyo-plugin.json', bytes: text('{"schemaVersion":1}') }],
        source: 'https',
      }),
    ).rejects.toMatchObject({ code: 'manifest' })
  })

  it('rejects per-file digest and size mismatches', async () => {
    const pkg = await makePackage()
    const tamperedFiles = pkg.files.map((file) =>
      file.path === 'main.js' ? { ...file, bytes: text('tampered content!') } : file,
    )
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: tamperedFiles, source: 'https' }),
    ).rejects.toMatchObject({
      code: 'files',
    })
  })

  it('rejects a declared-but-missing file and an undeclared extra file', async () => {
    const pkg = await makePackage()
    const withoutEntry = pkg.files.filter((file) => file.path !== 'main.js')
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: withoutEntry, source: 'https' }),
    ).rejects.toMatchObject({
      code: 'files',
    })
    const withExtra = [...pkg.files, { path: 'sneaky.js', bytes: text('evil') }]
    await expect(
      verifyPluginPackage({ packageBytes: pkg.packageBytes, files: withExtra, source: 'https' }),
    ).rejects.toMatchObject({
      code: 'files',
    })
  })

  it('rejects an entry whose content does not match entrySha256', async () => {
    const wrongSha = 'b'.repeat(64)
    const entryBytes = text('real content')
    const manifest = {
      schemaVersion: 1,
      id: 'demo',
      version: '1.0.0',
      displayName: 'Demo',
      description: 'A demo plugin with an intentionally wrong entry digest.',
      entry: 'main.js',
      entrySha256: wrongSha,
      capabilities: [{ name: 'tools', reason: 'Contributes the demo_x tool to the agent.' }],
      contributions: { tools: [{ name: 'demo_x', description: 'A test tool for digest checks.' }] },
      files: [{ path: 'main.js', size: entryBytes.byteLength, sha256: wrongSha }],
    }
    const files: DecodedPackageFile[] = [
      { path: 'yachiyo-plugin.json', bytes: text(JSON.stringify(manifest)) },
      { path: 'main.js', bytes: entryBytes },
    ]
    await expect(verifyPluginPackage({ packageBytes: text('pkg'), files, source: 'https' })).rejects.toMatchObject({
      code: 'files',
    })
  })

  it('enforces the per-plugin unpacked code quota before installation', async () => {
    const pkg = await makePackage()
    const asset = new Uint8Array(PLUGIN_STORAGE_LIMITS.maxPluginCodeBytes + 1)
    const assetSha = await sha256Hex(asset)
    const manifest = {
      ...pkg.manifest,
      files: [
        { path: 'main.js', size: pkg.entryBytes.byteLength, sha256: pkg.entrySha },
        { path: 'large.bin', size: asset.byteLength, sha256: assetSha },
      ],
    }
    await expect(
      verifyPluginPackage({
        packageBytes: pkg.packageBytes,
        source: 'https',
        files: [
          { path: 'yachiyo-plugin.json', bytes: text(JSON.stringify(manifest)) },
          { path: 'main.js', bytes: pkg.entryBytes },
          { path: 'large.bin', bytes: asset },
        ],
      }),
    ).rejects.toMatchObject({ code: 'files', message: 'plugin_code_too_large' })
  })

  it('exposes PluginInstallError with stable codes', async () => {
    const pkg = await makePackage()
    const error = await verifyPluginPackage({
      packageBytes: pkg.packageBytes,
      files: pkg.files,
      source: 'https',
      expectedSha256: 'c'.repeat(64),
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(PluginInstallError)
    expect(error.code).toBe('integrity')
  })
})
