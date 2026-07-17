import { afterEach, describe, expect, it, vi } from 'vitest'
import { qwenPortalOAuthProvider } from './qwen'

describe('qwenPortalOAuthProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts device flow and returns the completed verification URL when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: 'device-code',
          user_code: 'user-code',
          verification_uri: 'https://chat.qwen.ai/device',
          verification_uri_complete: 'https://chat.qwen.ai/device?code=user-code',
          interval: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const result = await qwenPortalOAuthProvider.startDeviceFlow()

    expect(result.userCode).toBe('user-code')
    expect(result.verificationUri).toBe('https://chat.qwen.ai/device?code=user-code')
  })

  it('polls for a token after authorization_pending responses', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: 'device-code',
            user_code: 'user-code',
            verification_uri: 'https://chat.qwen.ai/device',
            interval: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'authorization_pending' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    await qwenPortalOAuthProvider.startDeviceFlow()
    const credentials = await qwenPortalOAuthProvider.waitForToken()

    expect(credentials.accessToken).toBe('access-token')
    expect(credentials.refreshToken).toBe('refresh-token')
    expect(credentials.expiresAt).toBeTypeOf('number')
  })
})
