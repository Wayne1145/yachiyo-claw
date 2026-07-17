import type { ProviderSettings } from '../types'

/**
 * Resolve the effective API key for a provider, considering OAuth and platform.
 *
 * Rules:
 * - If activeAuthMode is 'oauth' AND oauth credentials exist AND platform is desktop → use OAuth token
 * - Otherwise → use apiKey
 * - Mobile/Web always falls back to apiKey even if OAuth is configured
 */
export function resolveEffectiveApiKey(
  providerSetting: ProviderSettings,
  platformType: 'desktop' | 'web' | 'mobile'
): string {
  if (platformType === 'desktop' && providerSetting.activeAuthMode === 'oauth' && providerSetting.oauth?.accessToken) {
    return providerSetting.oauth.accessToken
  }
  return providerSetting.apiKey || ''
}

/**
 * Check if OAuth credentials are expired or about to expire.
 */
export function isOAuthExpired(providerSetting: ProviderSettings): boolean {
  const oauth = providerSetting.oauth
  if (!oauth?.expiresAt) return false
  return Date.now() >= oauth.expiresAt
}

/**
 * Check if provider is using OAuth auth mode on a given platform.
 */
export function isUsingOAuth(providerSetting: ProviderSettings, platformType: 'desktop' | 'web' | 'mobile'): boolean {
  return (
    platformType === 'desktop' && providerSetting.activeAuthMode === 'oauth' && !!providerSetting.oauth?.accessToken
  )
}
