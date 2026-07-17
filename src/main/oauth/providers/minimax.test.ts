import { afterEach, describe, expect, it, vi } from 'vitest'
import { minimaxCnOAuthProvider, minimaxOAuthProvider } from './minimax'

describe('minimaxOAuthProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses the cn oauth base when starting the cn provider flow', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => {
      const requestBody = new URLSearchParams(String(init?.body || ''))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            user_code: 'user-code',
            verification_uri: 'https://www.minimaxi.com/oauth',
            interval: 0,
            state: requestBody.get('state'),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    })

    const result = await minimaxCnOAuthProvider.startDeviceFlow()

    expect(result.userCode).toBe('user-code')
    expect(result.verificationUri).toBe('https://www.minimaxi.com/oauth')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://api.minimaxi.com/oauth/code')
  })

  it('polls the global token endpoint for the global provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockImplementationOnce((_input, init) => {
      const requestBody = new URLSearchParams(String(init?.body || ''))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            user_code: 'user-code',
            verification_uri: 'https://www.minimax.io/oauth',
            interval: 0,
            state: requestBody.get('state'),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expired_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await minimaxOAuthProvider.startDeviceFlow()

    const credentials = await minimaxOAuthProvider.waitForToken()

    expect(credentials.accessToken).toBe('access-token')
    expect(credentials.refreshToken).toBe('refresh-token')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('https://api.minimax.io/oauth/token')
  })

  it('converts the device flow interval from seconds to milliseconds', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockImplementationOnce((_input, init) => {
        const requestBody = new URLSearchParams(String(init?.body || ''))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user_code: 'user-code',
              verification_uri: 'https://www.minimax.io/oauth',
              interval: 2,
              state: requestBody.get('state'),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            access_token: 'access-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    await minimaxOAuthProvider.startDeviceFlow()
    const waitPromise = minimaxOAuthProvider.waitForToken()

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const credentials = await waitPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(credentials.accessToken).toBe('access-token')
  })

  it('uses millisecond polling intervals returned by minimax as-is', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockImplementationOnce((_input, init) => {
        const requestBody = new URLSearchParams(String(init?.body || ''))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user_code: 'user-code',
              verification_uri: 'https://platform.minimax.io/oauth-authorize?user_code=user-code&client=OpenClaw',
              interval: 1000,
              state: requestBody.get('state'),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'success',
            access_token: 'access-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    await minimaxOAuthProvider.startDeviceFlow()
    const waitPromise = minimaxOAuthProvider.waitForToken()

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const credentials = await waitPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(credentials.accessToken).toBe('access-token')
  })

  it('fails fast when the token endpoint returns a business error in base_resp', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockImplementationOnce((_input, init) => {
        const requestBody = new URLSearchParams(String(init?.body || ''))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user_code: 'user-code',
              verification_uri: 'https://platform.minimax.io/oauth-authorize?user_code=user-code&client=OpenClaw',
              interval: 1000,
              state: requestBody.get('state'),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: '',
            base_resp: {
              status_code: 2013,
              status_msg: 'params error',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    await minimaxOAuthProvider.startDeviceFlow()
    const waitPromise = minimaxOAuthProvider.waitForToken()
    const rejection = expect(waitPromise).rejects.toThrow('MiniMax OAuth failed: params error')

    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
