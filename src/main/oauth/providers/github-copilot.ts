import log from 'electron-log/main'
import type { DeviceCodeOAuthProvider } from '../types'

const decode = (s: string) => Buffer.from(s, 'base64').toString()
const CLIENT_ID = decode('T3YyM2xpOHR3ZVF3Nm9kV1FlYno=')
const GITHUB_DOMAIN = 'github.com'

// Pending device flow state
let pendingDeviceCode: string | null = null
let pendingInterval = 5

function getUrls(domain: string) {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return response.json()
}

export const githubCopilotOAuthProvider: DeviceCodeOAuthProvider = {
  kind: 'device-code',
  providerId: 'github-copilot',
  name: 'GitHub Copilot',

  async startDeviceFlow() {
    const urls = getUrls(GITHUB_DOMAIN)
    const data = (await fetchJson(urls.deviceCodeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'read:user',
      }),
    })) as {
      device_code: string
      user_code: string
      verification_uri: string
      interval: number
    }

    pendingDeviceCode = data.device_code
    pendingInterval = Math.max(data.interval, 5)

    log.info(`[OAuth:Copilot] Device flow started, user_code=${data.user_code}`)

    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
    }
  },

  async waitForToken(signal?: AbortSignal) {
    if (!pendingDeviceCode) {
      throw new Error('No pending device flow. Call startDeviceFlow first.')
    }

    const deviceCode = pendingDeviceCode
    const urls = getUrls(GITHUB_DOMAIN)
    let intervalMs = pendingInterval * 1000

    const abortableSleep = (ms: number): Promise<void> =>
      new Promise((resolve, reject) => {
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

    try {
      // Poll for 10 minutes max
      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        await abortableSleep(intervalMs)

        const raw = (await fetchJson(urls.accessTokenUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })) as { access_token?: string; error?: string }

        if (raw.access_token) {
          log.info('[OAuth:Copilot] GitHub access token obtained')
          // Use the GitHub access token directly as the Copilot API credential
          // (same approach as openllmprovider)
          return {
            accessToken: raw.access_token,
            // No refresh token — the GitHub access token doesn't expire
            // but the Copilot API session may need re-auth periodically
          }
        }

        if (raw.error === 'authorization_pending') continue
        if (raw.error === 'slow_down') {
          intervalMs += 5000
          continue
        }

        throw new Error(`Device flow failed: ${raw.error}`)
      }

      throw new Error('Device flow timed out')
    } finally {
      pendingDeviceCode = null
    }
  },

  async refreshToken(credentials) {
    // GitHub access tokens from device flow don't expire in the traditional sense.
    // Just return the existing credentials.
    return credentials
  },
}
