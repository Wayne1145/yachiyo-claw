import { createGatewayProvider } from '@ai-sdk/gateway'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import { createFetchWithProxy } from '../../../models/utils/fetch-proxy'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  apiHost?: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  useProxy?: boolean
  stream?: boolean
}

export default class VercelAIGateway extends AbstractAISDKModel {
  public name = 'Vercel AI Gateway'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  protected getProvider() {
    return createGatewayProvider({
      apiKey: this.options.apiKey,
      ...(this.options.apiHost ? { baseURL: this.options.apiHost } : {}),
      fetch: createFetchWithProxy(this.options.useProxy, this.dependencies),
    })
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return provider.languageModel(this.options.model.modelId)
  }

  public async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const provider = this.getProvider()
      const response = await provider.getAvailableModels()
      return response.models
        .filter((m) => !m.modelType || m.modelType === 'language')
        .map((m) => {
          const capabilities: ProviderModelInfo['capabilities'] = []

          // Infer capabilities from the underlying provider in the model ID
          const providerId = m.specification?.provider || m.id.split('/')[0]
          if (providerId) {
            const lower = providerId.toLowerCase()
            // Most gateway models support tool use
            if (!lower.includes('perplexity')) {
              capabilities.push('tool_use')
            }
            // Vision support for known providers
            if (['anthropic', 'openai', 'google', 'xai', 'meta'].some((p) => lower.includes(p))) {
              capabilities.push('vision')
            }
          }

          return {
            modelId: m.id,
            nickname: m.name,
            type: 'chat' as const,
            ...(capabilities.length > 0 ? { capabilities } : {}),
          }
        })
    } catch (err) {
      console.error('Failed to fetch Vercel AI Gateway models:', err)
      return []
    }
  }
}
