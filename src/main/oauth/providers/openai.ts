import log from 'electron-log/main'
import type { OAuthCredentials } from '../../../shared/oauth'
import { createCallbackServer } from '../callback-server'
import { generatePKCE, generateState } from '../pkce'
import type { CallbackOAuthProvider } from '../types'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CALLBACK_HOST = 'localhost'
const CALLBACK_PORT = 1455
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}/auth/callback`
const SCOPE = 'openid profile email offline_access'

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined

  try {
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '==='.slice((base64.length + 3) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

function extractAccountId(token: string): string | undefined {
  const claims = decodeJwtPayload(token)
  if (!claims) return undefined

  const authClaim = claims['https://api.openai.com/auth']
  if (authClaim && typeof authClaim === 'object' && !Array.isArray(authClaim)) {
    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId === 'string' && accountId.length > 0) {
      return accountId
    }
  }

  return undefined
}

export const openaiOAuthProvider: CallbackOAuthProvider = {
  kind: 'callback',
  providerId: 'openai',
  name: 'ChatGPT Plus/Pro',

  async login({ openUrl, signal }) {
    const { verifier, challenge } = generatePKCE()
    const state = generateState()

    const authUrl = new URL(AUTHORIZE_URL)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('scope', SCOPE)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('id_token_add_organizations', 'true')
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
    authUrl.searchParams.set('originator', 'chatbox')

    const { promise, close } = createCallbackServer(CALLBACK_PORT, signal, CALLBACK_HOST)

    try {
      await openUrl(authUrl.toString())
      const result = await promise

      if (result.state !== state) {
        throw new Error('OAuth state mismatch')
      }

      return await exchangeCodeForTokens(result.code, verifier)
    } finally {
      close()
    }
  },

  async refreshToken(credentials) {
    if (!credentials.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        client_id: CLIENT_ID,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      log.error('[OAuth:OpenAI] Token refresh failed:', text)
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const data = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    if (!data.access_token) {
      throw new Error('Token refresh response missing access_token')
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || credentials.refreshToken,
      expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 - 5 * 60 * 1000 : undefined,
      extra: {
        accountId: extractAccountId(data.access_token),
      },
    }
  },
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    log.error('[OAuth:OpenAI] Token exchange failed:', text)
    throw new Error(`Token exchange failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!data.access_token) {
    throw new Error('Token exchange response missing access_token')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 - 5 * 60 * 1000 : undefined,
    extra: {
      accountId: extractAccountId(data.access_token),
    },
  }
}
