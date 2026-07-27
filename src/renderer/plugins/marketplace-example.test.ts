import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parsePluginMarketplaceCatalog } from '@shared/plugins/marketplace'
import { sha256Hex, verifyPackageSignature } from '@shared/skills/skillhub'
import { verifyPluginPackage } from '@shared/plugins/verify'
import { unpackPluginArchive } from './unpack'

describe('bundled plugin marketplace example', () => {
  it('refuses to rotate the official signer implicitly', () => {
    const { YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY: _removed, ...env } = process.env
    const result = spawnSync(process.execPath, ['scripts/build-example-marketplace.mjs'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY must point to the official P-256 private key')
  })

  it('pins a real package whose digest and P-256 signature verify', async () => {
    const catalog = parsePluginMarketplaceCatalog(JSON.parse(await readFile('plugin-marketplace/index.json', 'utf8')))
    expect(catalog.plugins).toHaveLength(1)
    const entry = catalog.plugins[0]
    const bytes = new Uint8Array(await readFile(`plugin-marketplace/packages/hello-yachiyo-${entry.version}.zip`))

    expect(bytes.byteLength).toBe(entry.packageSize)
    expect(await sha256Hex(bytes)).toBe(entry.sha256)
    await expect(verifyPackageSignature(bytes, entry.signature)).resolves.toBe(true)
    await expect(
      verifyPluginPackage({
        packageBytes: bytes,
        files: await unpackPluginArchive(bytes),
        source: 'marketplace',
        expectedSha256: entry.sha256,
        signature: entry.signature,
      })
    ).resolves.toMatchObject({
      signatureVerified: true,
      deviceGrantAllowed: true,
      manifest: { id: 'hello-yachiyo', version: entry.version },
    })
  })
})
