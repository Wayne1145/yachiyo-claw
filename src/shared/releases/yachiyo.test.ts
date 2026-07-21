import { describe, expect, it, vi } from 'vitest'
import {
  checkYachiyoGitHubUpdate,
  getLatestYachiyoAndroidRelease,
  isAllowedYachiyoReleaseAssetUrl,
  isNewerYachiyoVersion,
  normalizeYachiyoSha256,
  YACHIYO_LATEST_RELEASE_API,
} from './yachiyo'

describe('Yachiyo GitHub Releases update check', () => {
  it('compares v-prefixed release tags', () => {
    expect(isNewerYachiyoVersion('0.0.2', 'v0.0.3')).toBe(true)
    expect(isNewerYachiyoVersion('0.0.2', 'v0.0.2')).toBe(false)
    expect(isNewerYachiyoVersion('invalid', 'v0.0.3')).toBe(false)
  })

  it('checks only the public Yachiyo Claw release endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v0.0.3' }), { status: 200 }))
    await expect(checkYachiyoGitHubUpdate('0.0.2', fetchImpl as typeof fetch)).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(YACHIYO_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
  })

  it('treats a repository without Releases as up to date', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    await expect(checkYachiyoGitHubUpdate('0.0.2', fetchImpl as typeof fetch)).resolves.toBe(false)
  })

  it('selects the preferred release APK and GitHub digest', async () => {
    const digest = 'a'.repeat(64)
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.0.5',
            name: 'Yachiyo Claw 0.0.5',
            html_url: 'https://github.com/Wayne1145/yachiyo-claw/releases/tag/v0.0.5',
            assets: [
              {
                name: 'other.apk',
                browser_download_url: 'https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.5/other.apk',
                size: 10,
              },
              {
                name: 'yachiyo-claw-release.apk',
                browser_download_url:
                  'https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.5/yachiyo-claw-release.apk',
                size: 20,
                digest: `sha256:${digest}`,
              },
            ],
          }),
          { status: 200 }
        )
    )

    const result = await getLatestYachiyoAndroidRelease('0.0.4', fetchImpl as typeof fetch)
    expect(result?.version).toBe('0.0.5')
    expect(result?.apk.name).toBe('yachiyo-claw-release.apk')
    expect(result?.apk.sha256).toBe(digest)
  })

  it('uses an APK sha256 sidecar when the asset digest is unavailable', async () => {
    const base = 'https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.5/'
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: '0.0.5',
            assets: [
              { name: 'yachiyo-claw.apk', browser_download_url: `${base}yachiyo-claw.apk` },
              { name: 'yachiyo-claw.apk.sha256', browser_download_url: `${base}yachiyo-claw.apk.sha256` },
            ],
          }),
          { status: 200 }
        )
    )

    const result = await getLatestYachiyoAndroidRelease('0.0.4', fetchImpl as typeof fetch)
    expect(result?.apk.sha256).toBeUndefined()
    expect(result?.apk.sha256SidecarUrl).toBe(`${base}yachiyo-claw.apk.sha256`)
  })

  it('rejects non-GitHub, cleartext and unrelated release asset URLs', () => {
    expect(
      isAllowedYachiyoReleaseAssetUrl('https://github.com/Wayne1145/yachiyo-claw/releases/download/v1/app.apk')
    ).toBe(true)
    expect(
      isAllowedYachiyoReleaseAssetUrl('http://github.com/Wayne1145/yachiyo-claw/releases/download/v1/app.apk')
    ).toBe(false)
    expect(
      isAllowedYachiyoReleaseAssetUrl('https://example.com/Wayne1145/yachiyo-claw/releases/download/v1/app.apk')
    ).toBe(false)
    expect(isAllowedYachiyoReleaseAssetUrl('https://github.com/other/repo/releases/download/v1/app.apk')).toBe(false)
  })

  it('normalizes only valid SHA-256 digests', () => {
    expect(normalizeYachiyoSha256(`SHA256:${'B'.repeat(64)}`)).toBe('b'.repeat(64))
    expect(normalizeYachiyoSha256('sha256:not-a-digest')).toBeUndefined()
  })

  it('does not advertise an APK without a digest or sidecar', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.0.6',
            assets: [
              {
                name: 'yachiyo-claw-release.apk',
                browser_download_url:
                  'https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.6/yachiyo-claw-release.apk',
              },
            ],
          }),
          { status: 200 }
        )
    )

    await expect(getLatestYachiyoAndroidRelease('0.0.5', fetchImpl as typeof fetch)).resolves.toBeNull()
  })

  it('skips an unverifiable preferred APK in favor of a verifiable release APK', async () => {
    const base = 'https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.6/'
    const digest = 'c'.repeat(64)
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.0.6',
            assets: [
              { name: 'yachiyo-claw-release.apk', browser_download_url: `${base}yachiyo-claw-release.apk`, size: 50 },
              {
                name: 'app-release.apk',
                browser_download_url: `${base}app-release.apk`,
                size: 40,
                digest: `sha256:${digest}`,
              },
            ],
          }),
          { status: 200 }
        )
    )

    const result = await getLatestYachiyoAndroidRelease('0.0.5', fetchImpl as typeof fetch)
    expect(result?.apk.name).toBe('app-release.apk')
    expect(result?.apk.sha256).toBe(digest)
  })

  it('ignores drafts, prereleases and releases that are not newer', async () => {
    for (const payload of [
      { tag_name: 'v0.0.6', draft: true },
      { tag_name: 'v0.0.6', prerelease: true },
      { tag_name: 'v0.0.5' },
      { tag_name: 'v0.0.4' },
    ]) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
      await expect(getLatestYachiyoAndroidRelease('0.0.5', fetchImpl as typeof fetch)).resolves.toBeNull()
    }
  })
})
