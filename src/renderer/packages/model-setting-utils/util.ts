import { getSystemProviders } from '@shared/providers'
import type { ProviderModelInfo } from '@shared/types'
import { identity, omitBy } from 'lodash'
import { settingsStore } from '@/stores/settingsStore'

function updateModelInfo(localModel: ProviderModelInfo, newModelInfo: ProviderModelInfo) {
  return {
    ...newModelInfo,
    ...omitBy(localModel, identity),
  }
}

function updateLocalModels(providerId: string, latestModels: ProviderModelInfo[]) {
  const settings = settingsStore.getState().getSettings()

  if (!settings) return

  const localModels = settings.providers?.[providerId]?.models
  if (!localModels) return
  const updatedModels = localModels.map((model) => {
    const latestModel = latestModels.find((m) => m.modelId === model.modelId)
    if (!latestModel) return model
    return updateModelInfo(model, latestModel)
  })

  settingsStore.setState((state) => ({
    ...state,
    providers: {
      ...settings.providers,
      [providerId]: {
        ...settings.providers?.[providerId],
        models: updatedModels,
      },
    },
  }))
}

export function updateAllLocalModels() {
  getSystemProviders().forEach((provider) => {
    updateLocalModels(provider.id, provider.defaultSettings?.models ?? [])
  })
}
