import { createHash, randomBytes, randomUUID } from 'node:crypto'
import log from 'electron-log/main'
import type { DeviceCodeOAuthProvider } from '../types'

const QWEN_BASE_URL = 'https://chat.qwen.ai'
const QWEN_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'

let pendingDeviceCode: string | null = null
let pendingVerifier: string | null = null
let pendingIntervalMs = 2000

function generateVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

function toExpiresAt(expiresIn: number | undefined): number | undefined {
  if (!expiresIn) return undefined
  if (expiresIn > 10_000_000_000) {
    return expiresIn
  }
  return Date.now() + expiresIn * 1000 - 5 * 60 * 1000
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

export const qwenPortalOAuthProvider: DeviceCodeOAuthProvider = {
  kind: 'device-code',
  providerId: 'qwen-portal',
  name: 'Qwen Portal',

  async startDeviceFlow() {
    const verifier = generateVerifier()
    const challenge = sha256Base64Url(verifier)

    const response = await fetch(`${QWEN_BASE_URL}/api/v1/oauth2/device/code`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-request-id': randomUUID(),
      },
      body: new URLSearchParams({
        client_id: QWEN_CLIENT_ID,
        scope: 'openid profile email model.completion',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Qwen device authorization failed: ${text}`)
    }

    const payload = (await response.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete?: string
      expires_in?: number
      interval?: number
    }

    pendingDeviceCode = payload.device_code
    pendingVerifier = verifier
    pendingIntervalMs = payload.interval ? payload.interval * 1000 : 2000

    return {
      userCode: payload.user_code,
      verificationUri: payload.verification_uri_complete || payload.verification_uri,
    }
  },

  async waitForToken(signal?: AbortSignal) {
    if (!pendingDeviceCode || !pendingVerifier) {
      throw new Error('No pending device flow. Call startDeviceFlow first.')
    }

    const deviceCode = pendingDeviceCode
    const verifier = pendingVerifier

    try {
      const deadline = Date.now() + 10 * 60 * 1000
      let intervalMs = pendingIntervalMs

      while (Date.now() < deadline) {
        await abortableSleep(intervalMs, signal)

        const response = await fetch(`${QWEN_BASE_URL}/api/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: QWEN_CLIENT_ID,
            device_code: deviceCode,
            code_verifier: verifier,
          }).toString(),
        })

        if (response.ok) {
          const payload = (await response.json()) as {
            access_token?: string
            refresh_token?: string
            expires_in?: number
          }

          if (payload.access_token) {
            return {
              accessToken: payload.access_token,
              refreshToken: payload.refresh_token,
              expiresAt: toExpiresAt(payload.expires_in),
            }
          }
        } else {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string
            error_description?: string
          }

          if (payload.error === 'authorization_pending') {
            continue
          }
          if (payload.error === 'slow_down') {
            intervalMs = Math.min(intervalMs + 2000, 10_000)
            continue
          }

          throw new Error(`Qwen OAuth failed: ${payload.error_description || payload.error || response.statusText}`)
        }
      }

      throw new Error('Qwen OAuth timed out waiting for authorization.')
    } finally {
      pendingDeviceCode = null
      pendingVerifier = null
      pendingIntervalMs = 2000
    }
  },

  async refreshToken(credentials) {
    if (!credentials.refreshToken) {
      log.warn('[OAuth:Qwen] No refresh token available, returning existing credentials')
      return credentials
    }

    const response = await fetch(`${QWEN_BASE_URL}/api/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: QWEN_CLIENT_ID,
        refresh_token: credentials.refreshToken,
      }).toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      log.error('[OAuth:Qwen] Token refresh failed:', text)
      throw new Error(`Token refresh failed: ${text}`)
    }

    const payload = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || credentials.refreshToken,
      expiresAt: toExpiresAt(payload.expires_in),
    }
  },
}
