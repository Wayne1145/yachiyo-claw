import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parsePluginMarketplaceCatalog } from '@shared/plugins/marketplace'
import { verifyPluginPackage } from '@shared/plugins/verify'
import officialCatalog from '../../../plugin-marketplace/index.json'
import { DEFAULT_PLUGIN_MARKETPLACE_URL, downloadPluginPackage, loadPluginMarketplace, marketplacePackage, resolvePluginPackageSource } from './package-source'
import { unpackPluginArchive } from './unpack'

const [bundled] = parsePluginMarketplaceCatalog(officialCatalog).plugins
const customCatalog = 'https://plugins.example.com/catalog.json'
const catalogFetch = (plugins: unknown[]) => vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, plugins })))

describe('official marketplace updates for an older installed Ubuntu plugin', () => {
  it('offers the APK version for an outdated or empty official catalog and keeps unrelated remote entries', async () => {
    const stale = { ...bundled, version: '1.0.0' }
    const remoteOnly = { ...stale, id: 'remote-only' }
    expect(await loadPluginMarketplace(DEFAULT_PLUGIN_MARKETPLACE_URL, catalogFetch([stale, remoteOnly]))).toEqual([bundled, remoteOnly])
    expect(await loadPluginMarketplace(DEFAULT_PLUGIN_MARKETPLACE_URL, catalogFetch([]))).toContainEqual(bundled)
    expect(await loadPluginMarketplace(DEFAULT_PLUGIN_MARKETPLACE_URL, vi.fn().mockRejectedValue(new Error('offline')))).toContainEqual(bundled)
  })

  it('retains newer official packages and never substitutes an APK package into a third-party catalog', async () => {
    const newer = { ...bundled, version: '99.0.0', packageUrl: 'https://download.example.com/new.zip' }
    expect(await loadPluginMarketplace(DEFAULT_PLUGIN_MARKETPLACE_URL, catalogFetch([newer]))).toEqual([newer])
    expect(marketplacePackage(newer, DEFAULT_PLUGIN_MARKETPLACE_URL)).not.toHaveProperty('bundledAssetUrl')
    expect(await loadPluginMarketplace(customCatalog, catalogFetch([]))).toEqual([])
    expect(marketplacePackage(bundled, customCatalog)).not.toHaveProperty('bundledAssetUrl')
    const forged = { ...bundled, signature: { ...bundled.signature, value: 'substituted' } }
    expect(marketplacePackage(forged, DEFAULT_PLUGIN_MARKETPLACE_URL)).not.toHaveProperty('bundledAssetUrl')
  })

  it('reads the actual signed ZIP through the APK asset URL and rejects damaged local bytes', async () => {
    const source = marketplacePackage(bundled, DEFAULT_PLUGIN_MARKETPLACE_URL)
    expect(source.bundledAssetUrl).toBeTruthy()
    const original = await readFile(`plugin-marketplace/packages/${bundled.id}-${bundled.version}.zip`)
    const fetchAsset = vi.fn(async () => {
      const result = new Response(Uint8Array.from(original).buffer)
      Object.defineProperty(result, 'url', { value: 'https://localhost/assets/ubuntu-runtime.zip' })
      return result
    })
    const { bytes, downloadId } = await downloadPluginPackage(source, bundled.name, fetchAsset)
    expect(fetchAsset).toHaveBeenCalledWith(source.bundledAssetUrl, { mode: 'same-origin', redirect: 'error' })
    expect(downloadId).toBeUndefined()
    await expect(verifyPluginPackage({ packageBytes: bytes, files: await unpackPluginArchive(bytes), source: 'marketplace',
      signature: bundled.signature, expectedSha256: bundled.sha256 })).resolves.toMatchObject({
      signatureVerified: true, manifest: { id: bundled.id, version: bundled.version },
    })
    const damaged = Uint8Array.from(original)
    damaged[0] ^= 1
    await expect(downloadPluginPackage(source, bundled.name, vi.fn(async () => new Response(damaged)))).rejects.toThrow('plugin_package_digest_mismatch')
  })
})

describe('plugin package source resolution', () => {
  it('resolves a GitHub repository to its release plugin asset', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            assets: [
              {
                name: 'yachiyo-plugin.zip',
                browser_download_url: 'https://github.com/acme/demo/releases/download/v1/yachiyo-plugin.zip',
                size: 1234,
                digest: `sha256:${'a'.repeat(64)}`,
              },
            ],
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    await expect(resolvePluginPackageSource('https://github.com/acme/demo', fetchImpl)).resolves.toEqual({
      url: 'https://github.com/acme/demo/releases/download/v1/yachiyo-plugin.zip',
      size: 1234,
      sha256: 'a'.repeat(64),
    })
  })

  it('rejects private URLs before making a request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    await expect(resolvePluginPackageSource('https://127.0.0.1/plugin.zip', fetchImpl)).rejects.toThrow(
      'private_network_denied'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('probes a direct HTTPS package URL for a bounded size', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200, headers: { 'content-length': '2048' } })
    ) as unknown as typeof fetch
    await expect(resolvePluginPackageSource('https://downloads.example.com/demo.zip', fetchImpl)).resolves.toEqual({
      url: 'https://downloads.example.com/demo.zip',
      size: 2048,
    })
  })

  it('falls back to a one-byte range probe when HEAD has no size', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/4096' } })
      ) as unknown as typeof fetch
    await expect(
      resolvePluginPackageSource('https://downloads.example.com/demo.zip', fetchImpl)
    ).resolves.toMatchObject({ size: 4096 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('rejects every redirect hop before following it to a private host', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://127.0.0.1/plugin.zip' },
        })
    ) as unknown as typeof fetch

    await expect(resolvePluginPackageSource('https://downloads.example.com/demo.zip', fetchImpl)).rejects.toThrow(
      'private_network_denied'
    )
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://downloads.example.com/demo.zip',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    )
  })
})
