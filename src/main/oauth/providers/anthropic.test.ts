import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicOAuthProvider } from './anthropic'

describe('anthropicOAuthProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reuses the verifier as OAuth state for Anthropic compatibility', async () => {
    const startResult = await anthropicOAuthProvider.startLogin()
    const authUrl = new URL(startResult.authUrl)
    const state = authUrl.searchParams.get('state')
    const codeChallenge = authUrl.searchParams.get('code_challenge')

    expect(state).toBeTruthy()
    expect(codeChallenge).toBeTruthy()
    expect(state).not.toBe(codeChallenge)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await anthropicOAuthProvider.exchangeCode(
      `https://console.anthropic.com/oauth/code/callback?code=test-code&state=${state}`
    )

    const request = fetchMock.mock.calls[0]?.[1]
    expect(request).toBeDefined()
    const body = JSON.parse(String(request?.body))
    expect(body.state).toBe(state)
    expect(body.code_verifier).toBeTruthy()
    expect(body.code_verifier).toBe(state)
  })
})
