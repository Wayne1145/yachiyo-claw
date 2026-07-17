import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class ChatGLM extends OpenAICompatible {
  public name = 'ChatGLM'
  public options: Options

  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://open.bigmodel.cn/api/paas/v4/'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }

  public async listModels() {
    return []
  }
}
