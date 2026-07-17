import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Claude from './models/claude'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'

export const YACHIYO_API_HOST = 'https://api.yachiyo8000.cn/v1'
export const YACHIYO_DEFAULT_MODEL = 'gpt-5.6'

export const yachiyoProvider = defineProvider({
  id: ModelProviderEnum.Yachiyo,
  name: 'Yachiyo API',
  description: 'Yachiyo Claw built-in OpenAI Chat Completions compatible service',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://yachiyo8000.cn',
    apiKey: 'https://yachiyo8000.cn',
  },
  defaultSettings: {
    apiHost: YACHIYO_API_HOST,
    apiPath: '/chat/completions',
    models: [
      {
        modelId: YACHIYO_DEFAULT_MODEL,
        apiStyle: 'openai',
        capabilities: ['vision', 'tool_use', 'reasoning'],
      },
    ],
  },
  createModel: (config) => {
    if (config.model.apiStyle === 'openai-responses') {
      return new OpenAIResponses(
        {
          apiKey: config.effectiveApiKey,
          apiHost: YACHIYO_API_HOST,
          apiPath: '/responses',
          model: config.model,
          temperature: config.settings.temperature,
          topP: config.settings.topP,
          maxOutputTokens: config.settings.maxTokens,
          stream: config.settings.stream,
          useProxy: config.providerSetting.useProxy || false,
          listModelsFallback: yachiyoProvider.defaultSettings?.models,
        },
        config.dependencies
      )
    }

    if (config.model.apiStyle === 'anthropic') {
      return new Claude(
        {
          claudeApiKey: config.effectiveApiKey,
          claudeApiHost: YACHIYO_API_HOST,
          model: config.model,
          temperature: config.settings.temperature,
          topP: config.settings.topP,
          maxOutputTokens: config.settings.maxTokens,
          stream: config.settings.stream,
        },
        config.dependencies
      )
    }

    return new OpenAI(
      {
        apiKey: config.effectiveApiKey,
        // This product endpoint is intentionally fixed in source configuration.
        apiHost: YACHIYO_API_HOST,
        model: config.model,
        dalleStyle: config.settings.dalleStyle || 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        stream: config.settings.stream,
        useProxy: config.providerSetting.useProxy || false,
        listModelsFallback: yachiyoProvider.defaultSettings?.models,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) =>
    `Yachiyo API (${providerSettings?.models?.find((model) => model.modelId === modelId)?.nickname || modelId})`,
})
