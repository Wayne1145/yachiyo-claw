import { createHash, randomBytes, randomUUID } from 'node:crypto'
import log from 'electron-log/main'
import type { DeviceCodeOAuthProvider } from '../types'

const MINIMAX_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113'

function toExpiresAt(expiresIn: number | undefined): number | undefined {
  if (!expiresIn) return undefined
  if (expiresIn > 10_000_000_000) {
    return expiresIn
  }
  return Date.now() + expiresIn * 1000 - 5 * 60 * 1000
}

function toPollingIntervalMs(interval: number | undefined): number {
  if (interval === undefined || Number.isNaN(interval) || interval < 0) {
    return 2000
  }

  // MiniMax currently returns millisecond values such as 1000, while some
  // earlier responses and tests use second-based values like 2.
  if (interval >= 100) {
    return interval
  }

  return interval * 1000
}

function getMiniMaxErrorMessage(
  payload: {
    status?: string
    base_resp?: { status_code?: number; status_msg?: string }
  },
  fallback: string
): string | undefined {
  if (payload.status === 'pending') {
    return undefined
  }

  if (payload.status === 'error') {
    return payload.base_resp?.status_msg || fallback
  }

  if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
    return payload.base_resp.status_msg || fallback
  }

  return undefined
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'))
      return
    }

    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Login cancelled'))
      },
      { once: true }
    )
  })
}

function createMiniMaxOAuthProvider(config: { providerId: 'minimax' | 'minimax-cn'; name: string; baseUrl: string }) {
  let pendingUserCode: string | null = null
  let pendingVerifier: string | null = null
  let pendingIntervalMs = 2000

  const generatePkce = () => {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(16).toString('base64url')
    return { verifier, challenge, state }
  }

  const provider: DeviceCodeOAuthProvider = {
    kind: 'device-code',
    providerId: config.providerId,
    name: config.name,

    async startDeviceFlow() {
      const { verifier, challenge, state } = generatePkce()

      const response = await fetch(`${config.baseUrl}/oauth/code`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-request-id': randomUUID(),
        },
        body: new URLSearchParams({
          response_type: 'code',
          client_id: MINIMAX_CLIENT_ID,
          scope: 'group_id profile model.completion',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`MiniMax authorization failed: ${text}`)
      }

      const payload = (await response.json()) as {
        user_code: string
        verification_uri: string
        expired_in?: number
        interval?: number
        state: string
      }

      if (payload.state !== state) {
        throw new Error('MiniMax OAuth state mismatch')
      }

      pendingUserCode = payload.user_code
      pendingVerifier = verifier
      pendingIntervalMs = toPollingIntervalMs(payload.interval)

      return {
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
      }
    },

    async waitForToken(signal?: AbortSignal) {
      if (!pendingUserCode || !pendingVerifier) {
        throw new Error('No pending device flow. Call startDeviceFlow first.')
      }

      const userCode = pendingUserCode
      const verifier = pendingVerifier

      try {
        const deadline = Date.now() + 10 * 60 * 1000
        let intervalMs = pendingIntervalMs

        while (Date.now() < deadline) {
          await abortableSleep(intervalMs, signal)

          const response = await fetch(`${config.baseUrl}/oauth/token`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'urn:ietf:params:oauth:grant-type:user_code',
              client_id: MINIMAX_CLIENT_ID,
              user_code: userCode,
              code_verifier: verifier,
            }).toString(),
          })

          const text = await response.text()
          const payload = JSON.parse(text || '{}') as {
            status?: string
            access_token?: string
            refresh_token?: string
            expired_in?: number
            base_resp?: { status_code?: number; status_msg?: string }
          }

          if (response.ok && payload.access_token) {
            return {
              accessToken: payload.access_token,
              refreshToken: payload.refresh_token,
              expiresAt: toExpiresAt(payload.expired_in),
            }
          }

          const errorMessage = getMiniMaxErrorMessage(payload, text)
          if (!response.ok || errorMessage) {
            throw new Error(`MiniMax OAuth failed: ${errorMessage || text}`)
          }

          intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000)
        }

        throw new Error('MiniMax OAuth timed out waiting for authorization.')
      } finally {
        pendingUserCode = null
        pendingVerifier = null
        pendingIntervalMs = 2000
      }
    },

    async refreshToken(credentials) {
      if (!credentials.refreshToken) {
        return credentials
      }

      const response = await fetch(`${config.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: MINIMAX_CLIENT_ID,
          refresh_token: credentials.refreshToken,
        }).toString(),
      })

      const text = await response.text()
      if (!response.ok) {
        log.error(`[OAuth:${config.name}] Token refresh failed:`, text)
        throw new Error(`Token refresh failed: ${text}`)
      }

      const payload = JSON.parse(text || '{}') as {
        status?: string
        access_token?: string
        refresh_token?: string
        expired_in?: number
        base_resp?: { status_msg?: string }
      }

      if (payload.status !== 'success' || !payload.access_token) {
        throw new Error(`Token refresh failed: ${payload.base_resp?.status_msg || text}`)
      }

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || credentials.refreshToken,
        expiresAt: toExpiresAt(payload.expired_in),
      }
    },
  }

  return provider
}

export const minimaxOAuthProvider = createMiniMaxOAuthProvider({
  providerId: 'minimax',
  name: 'MiniMax Global',
  baseUrl: 'https://api.minimax.io',
})

export const minimaxCnOAuthProvider = createMiniMaxOAuthProvider({
  providerId: 'minimax-cn',
  name: 'MiniMax CN',
  baseUrl: 'https://api.minimaxi.com',
})
