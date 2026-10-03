import { ModelProviderEnum, ModelProviderType, type ProviderModelInfo } from '@shared/types'
import { useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProviders } from './useProviders'

export interface ImageModelOption {
  modelId: string
  displayName: string
}

export interface ImageModelGroup {
  label: string
  providerId: string
  isCustom?: boolean
  models: ImageModelOption[]
}

function manualImageModelToOption(model: ProviderModelInfo): ImageModelOption {
  return {
    modelId: model.modelId,
    displayName: model.nickname || model.modelId,
  }
}

export function useImageModelGroups(): ImageModelGroup[] {
  const { providers } = useProviders()
  const providerSettingsMap = useSettingsStore((state) => state.providers)

  const openAIProvider = providers.find((p) => p.id === ModelProviderEnum.OpenAI)
  const geminiProvider = providers.find((p) => p.id === ModelProviderEnum.Gemini)
  const customGeminiProviders = providers.filter((p) => p.isCustom && p.type === ModelProviderType.Gemini)

  return useMemo(() => {
    const groups: ImageModelGroup[] = []
    const candidates = [geminiProvider, ...customGeminiProviders, openAIProvider].filter(
      (provider): provider is NonNullable<typeof provider> => !!provider,
    )
    for (const provider of candidates) {
      const registryDefaults = (provider.models || provider.defaultSettings?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const excluded = new Set(providerSettingsMap?.[provider.id]?.excludedModels || [])
      const manual = (providerSettingsMap?.[provider.id]?.models || [])
        .filter((model) => model.type === 'image')
        .map(manualImageModelToOption)
      const byId = new Map<string, ImageModelOption>()
      for (const model of registryDefaults) if (!excluded.has(model.modelId)) byId.set(model.modelId, model)
      for (const model of manual) byId.set(model.modelId, model)
      const models = [...byId.values()]
      if (models.length > 0) {
        groups.push({
          label: provider.name,
          providerId: provider.id,
          isCustom: provider.isCustom,
          models,
        })
      }
    }
    return groups
  }, [openAIProvider, geminiProvider, customGeminiProviders, providerSettingsMap])
}
