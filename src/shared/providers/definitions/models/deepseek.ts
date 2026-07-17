import { createDeepSeek, type DeepSeekChatOptions } from '@ai-sdk/deepseek'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import AbstractAISDKModel, { type CallSettings } from '../../../models/abstract-ai-sdk'
import { ApiError } from '../../../models/errors'
import type { CallChatCompletionOptions } from '../../../models/types'
import type { ProviderModelInfo, ToolUseScope } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

export default class DeepSeek extends AbstractAISDKModel {
  public name = 'DeepSeek'

  constructor(
    public options: Options,
    dependencies: ModelDependencies
  ) {
    super(options, dependencies)
  }

  protected getProvider() {
    return createDeepSeek({
      apiKey: this.options.apiKey,
    })
  }

  protected getChatModel(_options: CallChatCompletionOptions): LanguageModelV3 {
    const provider = this.getProvider()
    return provider.chat(this.options.model.modelId)
  }

  protected getCallSettings(_options: CallChatCompletionOptions): CallSettings {
    const isReasonerModel = this.options.model.modelId === 'deepseek-reasoner'
    const settings: CallSettings = {
      maxOutputTokens: this.options.maxOutputTokens,
    }

    // reasoner model doesn't support temperature and topP
    if (!isReasonerModel) {
      settings.temperature = this.options.temperature
      settings.topP = this.options.topP
    }

    // Enable thinking for reasoner model
    if (this.isSupportReasoning()) {
      settings.providerOptions = {
        deepseek: {
          thinking: {
            type: 'enabled',
          },
        } satisfies DeepSeekChatOptions,
      }
    }

    return settings
  }

  isSupportToolUse(scope?: ToolUseScope) {
    if (
      scope &&
      ['web-browsing', 'read-file'].includes(scope) &&
      /deepseek-(v3|r1)$/.test(this.options.model.modelId.toLowerCase())
    ) {
      return false
    }
    return super.isSupportToolUse()
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const res = await this.dependencies.request.apiRequest({
      url: 'https://api.deepseek.com/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
    })
    const json = await res.json()
    if (!json.data) {
      throw new ApiError(JSON.stringify(json))
    }
    return json.data
      .map((m: { id: string; owned_by?: string }) => ({
        modelId: m.id,
        type: 'chat' as const,
      }))
      .sort((a: ProviderModelInfo, b: ProviderModelInfo) => a.modelId.localeCompare(b.modelId))
  }
}
