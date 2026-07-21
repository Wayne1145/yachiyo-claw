import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import LocalNativeModel from './models/local-native'

export const localProvider = defineProvider({
  id: ModelProviderEnum.Local,
  name: '本地模型',
  type: ModelProviderType.OpenAI,
  defaultSettings: { models: [] },
  createModel: (config) => new LocalNativeModel(config.model, config.dependencies),
  getDisplayName: (modelId, providerSettings) =>
    providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId,
})
