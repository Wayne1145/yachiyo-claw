import { describe, expect, it, vi } from 'vitest'
import { checkYachiyoGitHubUpdate, isNewerYachiyoVersion, YACHIYO_LATEST_RELEASE_API } from './yachiyo'

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
})
