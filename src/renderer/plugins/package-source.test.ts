import { describe, expect, it, vi } from 'vitest'
import { resolvePluginPackageSource } from './package-source'

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
