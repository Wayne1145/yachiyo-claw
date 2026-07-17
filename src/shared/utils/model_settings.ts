import type { Settings } from '../types'

export function getModelSettings(globalSettings: Settings, providerId: string, modelId: string) {
  const providerEntry = Object.entries(globalSettings.providers ?? {}).find(([key]) => key === providerId)
  if (!providerEntry) {
    const error = new Error(`provider ${providerId} not set`)

    throw error
  }

  return {
    ...globalSettings,
    provider: providerId,
    modelId,
  }
}
