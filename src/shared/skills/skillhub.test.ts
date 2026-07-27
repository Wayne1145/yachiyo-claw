import { describe, expect, it, vi } from 'vitest'
import {
  inspectSkillArchive,
  sha256Hex,
  SkillHubAdapter,
  SkillHubError,
  verifyEcdsaP256Signature,
  verifyEd25519Signature,
  verifyPackageSignature,
} from './skillhub'

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('SkillHub adapter', () => {
  it('normalizes search metadata', async () => {
    const request = vi.fn(async () => json({ data: { items: [{ id: 'reader', slug: 'reader', title: 'Reader', revision: 'abc' }] } }))
    const result = await new SkillHubAdapter({ fetch: request }).search({ query: 'reader' })
    expect(result.items[0]).toMatchObject({ skillId: 'reader', name: 'Reader', revision: 'abc' })
  })

  it('can be disabled', async () => {
    await expect(new SkillHubAdapter({ enabled: false, fetch: vi.fn() }).search()).rejects.toMatchObject({ code: 'disabled' })
  })

  it('resolves immutable download metadata without buffering the package', async () => {
    const hash = 'a'.repeat(64)
    const request = vi.fn(async () =>
      json({ data: { downloadUrl: 'https://cdn.example.com/reader.zip', sizeBytes: 4096, sha256: hash } })
    )
    await expect(new SkillHubAdapter({ fetch: request }).resolveDownload('reader', 'commit-1')).resolves.toMatchObject({
      slug: 'reader',
      revision: 'commit-1',
      url: 'https://cdn.example.com/reader.zip',
      sizeBytes: 4096,
      sha256: hash,
    })
  })

  it('rejects unsafe or executable archives', () => {
    expect(() => inspectSkillArchive([{ path: '../SKILL.md', size: 1 }])).toThrow(SkillHubError)
    expect(() => inspectSkillArchive([{ path: 'SKILL.md', size: 1 }, { path: 'scripts/run.sh', size: 1 }])).toThrow('disabled')
    expect(
      inspectSkillArchive(
        [
          { path: 'SKILL.md', size: 1 },
          { path: 'scripts/run.sh', size: 1 },
        ],
        { allowScripts: true }
      )
    ).toMatchObject({ containsScripts: true })
  })

  it('computes hashes and rejects malformed signatures', async () => {
    await expect(sha256Hex('hello')).resolves.toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    await expect(verifyEd25519Signature('data', 'bad', 'bad')).resolves.toBe(false)
    await expect(verifyEcdsaP256Signature('data', 'bad', 'bad')).resolves.toBe(false)
  })

  it('verifies a real ECDSA P-256 signature and dispatches by declared algorithm', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
    const data = new TextEncoder().encode('package-bytes')
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, data))
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

    await expect(verifyEcdsaP256Signature(data, b64(raw), b64(spki))).resolves.toBe(true)
    await expect(verifyEcdsaP256Signature(new TextEncoder().encode('tampered'), b64(raw), b64(spki))).resolves.toBe(false)
    await expect(
      verifyPackageSignature(data, { algorithm: 'ecdsa-p256', value: b64(raw), publicKey: b64(spki) })
    ).resolves.toBe(true)
    // Missing public key must fail closed, never pass.
    await expect(verifyPackageSignature(data, { algorithm: 'ecdsa-p256', value: b64(raw) })).resolves.toBe(false)
  })
})
