import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import type { ProviderModelInfo, ToolUseScope } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'

type FetchFunction = typeof globalThis.fetch

interface Options {
  apiKey: string
  model: ProviderModelInfo
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stream?: boolean
}

const Host = 'https://ark.cn-beijing.volces.com'
const Path = '/api/v3/chat/completions'

export default class VolcEngine extends AbstractAISDKModel {
  public name = 'VolcEngine'

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

  static isSupportTextEmbedding() {
    return true
  }

  protected getProvider() {
    return createOpenAICompatible({
      name: this.name,
      apiKey: this.options.apiKey,
      baseURL: Host,
      fetch: async (_input, init) => {
        return fetch(`${Host}${Path}`, init)
      },
    })
  }
  protected getChatModel() {
    const provider = this.getProvider()
    return provider.chatModel(this.options.model.modelId)
  }

  isSupportToolUse(scope?: ToolUseScope) {
    if (scope === 'web-browsing' && /deepseek-(v3|r1)$/.test(this.options.model.modelId.toLowerCase())) {
      return false
    }
    return super.isSupportToolUse()
  }
}
