import type { DeviceFlowStartResult, OAuthProviderInfo, OAuthResult, OAuthStartResult } from '@shared/oauth'
import { useCallback } from 'react'
import { useProviderSettings } from '@/stores/settingsStore'

const UNAVAILABLE = 'OAuth login is not available on this platform'

/**
 * Provider OAuth (OpenAI / Anthropic / Copilot login) ran through the Electron main process and left
 * with the desktop target. The hook keeps its shape so provider settings can still surface and clear
 * a previously stored credential; every login flow reports that it is unavailable.
 */
export function useOAuth(
  oauthProviderId: string,
  providerInfo?: OAuthProviderInfo,
  settingsProviderId = oauthProviderId,
  authModeProviderId = settingsProviderId
) {
  const { providerSettings: tokenProviderSettings, setProviderSettings: setTokenProviderSettings } =
    useProviderSettings(settingsProviderId)
  const { providerSettings: authModeProviderSettings, setProviderSettings: setAuthModeProviderSettings } =
    useProviderSettings(authModeProviderId)

  const hasOAuth = !!tokenProviderSettings?.oauth?.accessToken
  const isOAuthActive = authModeProviderSettings?.activeAuthMode === 'oauth' && hasOAuth
  const flowType = providerInfo?.flowType ?? 'callback'

  const unavailable = useCallback(async (): Promise<OAuthResult> => ({ success: false, error: UNAVAILABLE }), [])
  const unavailableStart = useCallback(
    async (): Promise<OAuthStartResult> => ({ success: false, error: UNAVAILABLE }),
    []
  )
  const unavailableDeviceFlow = useCallback(
    async (): Promise<DeviceFlowStartResult> => ({ success: false, error: UNAVAILABLE }),
    []
  )
  const noop = useCallback(async () => undefined, [])

  const logout = useCallback(() => {
    setTokenProviderSettings({ oauth: undefined })
    setAuthModeProviderSettings({ activeAuthMode: authModeProviderSettings?.apiKey ? 'apikey' : undefined })
  }, [authModeProviderSettings?.apiKey, setAuthModeProviderSettings, setTokenProviderSettings])

  return {
    isDesktop: false as const,
    hasOAuth,
    isOAuthActive,
    flowType,
    loginCallback: unavailable,
    startLogin: unavailableStart,
    exchangeCode: unavailable as (code: string) => Promise<OAuthResult>,
    startDeviceFlow: unavailableDeviceFlow,
    waitForDeviceToken: unavailable,
    cancel: noop,
    logout,
    refreshToken: noop,
  }
}
