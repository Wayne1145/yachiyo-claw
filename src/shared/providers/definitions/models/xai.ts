import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class XAI extends OpenAICompatible {
  public name = 'xAI'
  public options: Options
  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api.x.ai/v1'
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
}
