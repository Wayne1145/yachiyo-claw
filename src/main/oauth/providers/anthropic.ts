import log from 'electron-log/main'
import { generatePKCE } from '../pkce'
import type { CodePasteOAuthProvider } from '../types'

const decode = (s: string) => Buffer.from(s, 'base64').toString()
const CLIENT_ID = decode('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl')
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPES = 'org:create_api_key user:profile user:inference'

// Anthropic's Claude Code OAuth flow is not fully standard here: the authorize page rejects
// requests if `state` is decoupled from the PKCE verifier. A previous refactor to separate
// them caused the browser to fail with "Authorization failed / Invalid request format".
// Keep this verifier-based state unless Anthropic documents a different contract and the
// end-to-end browser flow is re-verified.
let pendingVerifier: string | null = null

/**
 * Parse the user-pasted callback input.
 * Accepts:
 * - Full URL: https://console.anthropic.com/oauth/code/callback?code=xxx&state=yyy
 * - Query string: ?code=xxx&state=yyy or code=xxx&state=yyy
 * - Bare code: just the authorization code itself
 * - Code#state format: code_value#state_value
 */
function parseCallbackInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim()

  // Try parsing as full URL
  try {
    const url = new URL(trimmed)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (code) return { code, state: state || undefined }
  } catch {
    // Not a full URL, continue
  }

  // Try parsing as query string
  if (trimmed.includes('code=')) {
    try {
      const qs = trimmed.startsWith('?') ? trimmed : `?${trimmed}`
      const params = new URLSearchParams(qs.slice(1))
      const code = params.get('code')
      const state = params.get('state')
      if (code) return { code, state: state || undefined }
    } catch {
      // Not a query string, continue
    }
  }

  // Try code#state format
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#')
    if (code) return { code, state: state || undefined }
  }

  // Bare code
  return { code: trimmed }
}

export const anthropicOAuthProvider: CodePasteOAuthProvider = {
  kind: 'code-paste',
  providerId: 'claude',
  name: 'Anthropic (Claude Pro/Max)',
  codeInputMessage: 'After authorizing, paste the full callback URL or authorization code below:',

  async startLogin() {
    const { verifier, challenge } = generatePKCE()
    pendingVerifier = verifier

    const authParams = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Do not replace this with a separate random state. Anthropic expects the verifier here.
      state: verifier,
    })

    const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`
    return { authUrl }
  },

  async exchangeCode(authInput: string) {
    if (!pendingVerifier) {
      throw new Error('No pending login flow. Call startLogin first.')
    }

    const verifier = pendingVerifier
    pendingVerifier = null

    const { code, state } = parseCallbackInput(authInput)

    if (!code) {
      throw new Error('No authorization code found in the input')
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        // Preserve the verifier-backed state on exchange as well, otherwise Anthropic rejects
        // the flow even though this differs from a more typical OAuth implementation.
        state: state || verifier,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      log.error('[OAuth:Anthropic] Token exchange failed:', error)
      throw new Error(`Token exchange failed: ${error}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    }
  },

  async refreshToken(credentials) {
    if (!credentials.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: credentials.refreshToken,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      log.error('[OAuth:Anthropic] Token refresh failed:', error)
      throw new Error(`Token refresh failed: ${error}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    }
  },
}
