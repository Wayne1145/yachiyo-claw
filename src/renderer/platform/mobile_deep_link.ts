export const MOBILE_PROVIDER_IMPORT_MARKER = 'mobile-deep-link'
export const MOBILE_PROVIDER_IMPORT_PATH = `/settings/provider?import=${MOBILE_PROVIDER_IMPORT_MARKER}`

const MAX_PROVIDER_IMPORT_LENGTH = 256 * 1024

let pendingProviderImport: string | null = null
let pendingMcpOAuthCallback: string | null = null

export type MobileDeepLinkResult =
  | { kind: 'navigate'; path: typeof MOBILE_PROVIDER_IMPORT_PATH }
  | { kind: 'handled' }
  | {
      kind: 'rejected'
      reason: 'invalid-url' | 'unsupported-scheme' | 'unsupported-route' | 'missing-config' | 'config-too-large'
    }

export function acceptMobileDeepLink(url: string): MobileDeepLinkResult {
  try {
    const normalizedUrl = url.replace(/^yachiyoclaw-dev:\/\//, 'yachiyoclaw://')
    const parsedUrl = new URL(normalizedUrl)

    if (parsedUrl.protocol !== 'yachiyoclaw:') {
      return { kind: 'rejected', reason: 'unsupported-scheme' }
    }

    if (parsedUrl.hostname === 'provider' && parsedUrl.pathname === '/import') {
      const encodedConfig = parsedUrl.searchParams.get('config') || ''
      if (!encodedConfig) {
        return { kind: 'rejected', reason: 'missing-config' }
      }
      if (encodedConfig.length > MAX_PROVIDER_IMPORT_LENGTH) {
        return { kind: 'rejected', reason: 'config-too-large' }
      }

      // Credentials remain transient in memory and never enter browser history.
      pendingProviderImport = encodedConfig
      return { kind: 'navigate', path: MOBILE_PROVIDER_IMPORT_PATH }
    }

    if (parsedUrl.hostname === 'auth' && parsedUrl.pathname === '/callback') {
      return { kind: 'handled' }
    }

    if (parsedUrl.hostname === 'oauth' && parsedUrl.pathname === '/mcp') {
      if (url.length > 16 * 1024) {
        return { kind: 'rejected', reason: 'config-too-large' }
      }
      // The authorization code remains transient and is consumed by the OAuth controller.
      pendingMcpOAuthCallback = normalizedUrl
      return { kind: 'handled' }
    }

    return { kind: 'rejected', reason: 'unsupported-route' }
  } catch {
    return { kind: 'rejected', reason: 'invalid-url' }
  }
}

export function consumePendingProviderImport(): string | null {
  const encodedConfig = pendingProviderImport
  pendingProviderImport = null
  return encodedConfig
}

export function consumePendingMcpOAuthCallback(): string | null {
  const callback = pendingMcpOAuthCallback
  pendingMcpOAuthCallback = null
  return callback
}
