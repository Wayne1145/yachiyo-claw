import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadRemoteTheme } from './remote-theme'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}))

const manifest = JSON.stringify({
  schemaVersion: 1,
  id: 'remote-rose',
  name: 'Remote rose',
  version: '1.0.0',
  mode: 'light',
  tokens: { 'tint-brand': '#c05d80' },
})

describe('remote themes', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('probes and downloads a bounded public HTTPS manifest', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { 'content-length': String(manifest.length) } }),
      )
      .mockResolvedValueOnce(
        new Response(manifest, { status: 200, headers: { 'content-length': String(manifest.length) } }),
      )

    await expect(downloadRemoteTheme('https://themes.example/yachiyo.json', fetchImpl)).resolves.toBe(manifest)
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://themes.example/yachiyo.json', {
      method: 'HEAD',
      redirect: 'manual',
    })
  })

  it('rejects insecure and private-network sources before fetching', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(downloadRemoteTheme('http://example.com/theme.json', fetchImpl)).rejects.toThrow(
      'theme_url_must_be_public_https',
    )
    await expect(downloadRemoteTheme('https://127.0.0.1/theme.json', fetchImpl)).rejects.toThrow(
      'theme_url_private_network_denied',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a declared manifest above the theme size limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200, headers: { 'content-length': String(65 * 1024) } }),
    )
    await expect(downloadRemoteTheme('https://themes.example/huge.json', fetchImpl)).rejects.toThrow(
      'theme_manifest_size_invalid',
    )
  })
})
