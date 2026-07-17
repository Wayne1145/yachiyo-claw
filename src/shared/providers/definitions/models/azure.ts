import { createAzure } from '@ai-sdk/azure'
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import type { ProviderModelInfo } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import { normalizeAzureEndpoint } from '../../../utils/llm_utils'

interface Options {
  azureEndpoint: string
  model: ProviderModelInfo
  azureDalleDeploymentName: string // dall-e-3 的部署名称
  azureApikey: string
  azureApiVersion: string

  // openaiMaxTokens: number
  temperature?: number
  topP?: number
  maxOutputTokens?: number

  dalleStyle: 'vivid' | 'natural'
  imageGenerateNum: number // 生成图片的数量

  injectDefaultMetadata: boolean
  stream?: boolean
}

export default class AzureOpenAI extends AbstractAISDKModel {
  public name = 'Azure OpenAI'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createAzure({
      apiKey: this.options.azureApikey,
      baseURL: normalizeAzureEndpoint(this.options.azureEndpoint).endpoint,
      useDeploymentBasedUrls: false,
    })
  }

  protected getCallSettings() {
    return {
      temperature: this.options.temperature,
      topP: this.options.topP,
      maxOutputTokens: this.options.maxOutputTokens,
    }
  }

  protected getChatModel() {
    const provider = this.getProvider()
    return wrapLanguageModel({
      model: provider.chat(this.options.model.modelId),
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  }

  protected getImageModel() {
    const provider = this.getProvider()
    return provider.imageModel(this.options.model.modelId)
  }
}
