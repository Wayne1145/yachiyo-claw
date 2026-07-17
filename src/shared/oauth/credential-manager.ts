import type { ModelDependencies } from '../types/adapters'
import type { ProviderSettings } from '../types/settings'
import { toOAuthProviderId, toOAuthSettingsProviderId } from './provider-mapping'
import type { OAuthCredentials } from './types'

const REFRESH_EARLY_MS = 2 * 60 * 1000

function shouldRefreshCredential(credential: OAuthCredentials): boolean {
  if (!credential.expiresAt) return false
  return credential.expiresAt <= Date.now() + REFRESH_EARLY_MS
}

export interface OAuthCredentialManager {
  getCredential(): Promise<OAuthCredentials>
  getAccessToken(): Promise<string>
  clear(): void
}

export function createOAuthCredentialManager(
  chatboxProviderId: string,
  providerSetting: ProviderSettings,
  dependencies: ModelDependencies
): OAuthCredentialManager | undefined {
  if (dependencies.platformType !== 'desktop' || providerSetting.activeAuthMode !== 'oauth' || !providerSetting.oauth) {
    return undefined
  }

  const oauthProviderId = toOAuthProviderId(chatboxProviderId)
  const settingsProviderId = toOAuthSettingsProviderId(chatboxProviderId)
  if (!oauthProviderId || !settingsProviderId) {
    return undefined
  }

  let credential: OAuthCredentials | undefined = providerSetting.oauth
  let refreshPromise: Promise<OAuthCredentials> | undefined

  const persistCredential = (nextCredential: OAuthCredentials) => {
    credential = nextCredential
    dependencies.oauth?.persistCredential(settingsProviderId, nextCredential)
  }

  const clearCredential = () => {
    credential = undefined
    dependencies.oauth?.clearCredential(settingsProviderId)
  }

  const refreshCredential = async (): Promise<OAuthCredentials> => {
    if (!credential) {
      throw new Error(`OAuth credential missing for provider: ${chatboxProviderId}`)
    }
    if (!dependencies.oauth) {
      return credential
    }
    if (!refreshPromise) {
      refreshPromise = dependencies.oauth
        .refreshCredential(oauthProviderId, credential)
        .then((nextCredential) => {
          persistCredential(nextCredential)
          return nextCredential
        })
        .finally(() => {
          refreshPromise = undefined
        })
    }
    return refreshPromise
  }

  return {
    async getCredential() {
      if (!credential) {
        throw new Error(`OAuth credential missing for provider: ${chatboxProviderId}`)
      }
      if (shouldRefreshCredential(credential)) {
        return refreshCredential()
      }
      return credential
    },
    async getAccessToken() {
      const nextCredential = await this.getCredential()
      return nextCredential.accessToken
    },
    clear() {
      clearCredential()
    },
  }
}
