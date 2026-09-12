import type { OAuthProviderInfo } from '@shared/oauth'

/**
 * Provider OAuth was brokered by the Electron main process and left with the desktop target,
 * so no provider advertises an OAuth flow. Kept so provider settings can stay platform-agnostic.
 */
export function useOAuthProviders(): OAuthProviderInfo[] {
  return []
}
