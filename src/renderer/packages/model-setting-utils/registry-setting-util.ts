import { mergeSharedOAuthProviderSettings, resolveEffectiveApiKey } from '@shared/oauth'
import { getProviderDefinition } from '@shared/providers'
import type { ModelProvider, ProviderBaseInfo, ProviderModelInfo, ProviderSettings, SessionType } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { settingsStore } from '@/stores/settingsStore'
import BaseConfig from './base-config'
import type { ModelSettingUtil } from './interface'

export default class RegistrySettingUtil extends BaseConfig implements ModelSettingUtil {
  public provider: ModelProvider

  constructor(provider: ModelProvider) {
    super()
    this.provider = provider
  }

  async getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    _providerBaseInfo?: ProviderBaseInfo
  ): Promise<string> {
    const definition = getProviderDefinition(this.provider)
    if (definition?.getDisplayName) {
      const displayName = definition.getDisplayName(model, providerSettings, sessionType)
      if (displayName instanceof Promise) {
        return displayName
      }
      return displayName
    }
    return `${definition?.name || this.provider} (${providerSettings?.models?.find((m) => m.modelId === model)?.nickname || model})`
  }

  protected async listProviderModels(settings: ProviderSettings): Promise<ProviderModelInfo[]> {
    const definition = getProviderDefinition(this.provider)
    if (!definition) {
      return []
    }

    const storedProviders = settingsStore.getState().providers || {}
    const mergedSettings = mergeSharedOAuthProviderSettings(this.provider, {
      ...storedProviders,
      [this.provider]: {
        ...(storedProviders[this.provider] || {}),
        ...settings,
      },
    })
    const model: ProviderModelInfo = mergedSettings.models?.[0] ||
      settings.models?.[0] ||
      definition.defaultSettings?.models?.[0] || { modelId: '' }
    const dependencies = await createModelDependencies()

    // When OAuth is active, use the provider's default API host (OAuth tokens are issued for specific endpoints)
    const isOAuthActive = mergedSettings.activeAuthMode === 'oauth' && !!mergedSettings.oauth?.accessToken
    const formattedApiHost = (
      (isOAuthActive ? '' : mergedSettings.apiHost) ||
      definition.defaultSettings?.apiHost ||
      ''
    ).trim()

    const modelInstance = definition.createModel({
      settings: { provider: this.provider, modelId: model.modelId },
      globalSettings: { providers: { [this.provider]: mergedSettings } } as Parameters<
        typeof definition.createModel
      >[0]['globalSettings'],
      config: { uuid: '' },
      dependencies,
      providerSetting: mergedSettings,
      formattedApiHost,
      formattedApiPath: mergedSettings.apiPath || definition.defaultSettings?.apiPath || '',
      model,
      effectiveApiKey: resolveEffectiveApiKey(mergedSettings, dependencies.platformType || 'desktop'),
    })

    if ('listModels' in modelInstance && typeof modelInstance.listModels === 'function') {
      return modelInstance.listModels()
    }

    return []
  }
}
