import type { ProviderSettings, Settings } from '@shared/types/settings'

const OAUTH_PROVIDER_MAP: Record<string, string | undefined> = {
  claude: 'claude',
  'qwen-portal': 'qwen-portal',
  minimax: 'minimax',
  'minimax-cn': 'minimax-cn',
  openai: 'openai',
  'openai-responses': 'openai',
  'github-copilot': 'github-copilot',
}

export function toOAuthProviderId(chatboxProviderId: string): string | undefined {
  return OAUTH_PROVIDER_MAP[chatboxProviderId]
}

// Kept separate from toOAuthProviderId because some providers may share credential storage
// without sharing their runtime OAuth provider implementation in the future.
export function toOAuthSettingsProviderId(chatboxProviderId: string): string | undefined {
  return OAUTH_PROVIDER_MAP[chatboxProviderId]
}

export function mergeSharedOAuthProviderSettings(
  providerId: string,
  providers: Settings['providers'] | undefined
): ProviderSettings {
  const providerSetting = providers?.[providerId] || {}
  const oauthSettingsProviderId = toOAuthSettingsProviderId(providerId)
  if (!oauthSettingsProviderId) {
    // Provider has no OAuth support — strip any leftover OAuth config
    if (providerSetting.oauth || providerSetting.activeAuthMode) {
      const { oauth: _, activeAuthMode: __, ...rest } = providerSetting
      return rest
    }
    return providerSetting
  }
  if (oauthSettingsProviderId === providerId) {
    return providerSetting
  }

  const oauthSettings = providers?.[oauthSettingsProviderId] || {}
  return {
    ...providerSetting,
    // Some providers reuse another provider's OAuth credential storage. Only the credential is shared;
    // auth mode remains provider-local so users can choose API key vs OAuth independently per provider.
    oauth: oauthSettings.oauth,
  }
}
