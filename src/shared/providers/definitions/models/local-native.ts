import type { ModelMessage, ToolSet } from 'ai'
import type { ProviderModelInfo, StreamTextResult } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import type {
  CallChatCompletionOptions,
  ChatStreamOptions,
  ModelInterface,
  ModelStreamPart,
} from '../../../models/types'

export default class LocalNativeModel implements ModelInterface {
  readonly name = 'Yachiyo Local'
  readonly modelId: string

  constructor(
    private readonly model: ProviderModelInfo,
    private readonly dependencies: ModelDependencies
  ) {
    this.modelId = model.modelId
  }

  isSupportVision(): boolean {
    return this.model.capabilities?.includes('vision') || false
  }

  isSupportToolUse(): boolean {
    return false
  }

  isSupportSystemMessage(): boolean {
    return true
  }

  async chat(messages: ModelMessage[], options: CallChatCompletionOptions): Promise<StreamTextResult> {
    let text = ''
    for await (const event of this.chatStream(messages, options)) {
      if (event.type === 'text-delta') text += event.text
    }
    const contentParts = [{ type: 'text' as const, text }]
    options.onResultChange?.({ contentParts })
    return { contentParts, finishReason: 'stop' }
  }

  async *chatStream<T extends ToolSet>(
    messages: ModelMessage[],
    options: ChatStreamOptions
  ): AsyncGenerator<ModelStreamPart<T>> {
    const adapter = this.dependencies.localInference
    if (!adapter || !(await adapter.isAvailable(this.modelId))) throw new Error('local_model_not_available')
    await options.agentLifecycle?.beforeRequest?.({ stepNumber: 0, messages, tools: options.tools })
    try {
      for await (const event of adapter.stream(this.modelId, { messages, signal: options.signal })) {
        if (event.type === 'text' && event.text) {
          yield { type: 'text-delta', id: `local-${this.modelId}`, text: event.text } as ModelStreamPart<T>
        }
      }
      const usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
      yield { type: 'finish', finishReason: 'stop', totalUsage: usage } as ModelStreamPart<T>
      await options.agentLifecycle?.onFinish?.({ usage, result: { local: true } })
    } catch (error) {
      if (options.signal?.aborted) await options.agentLifecycle?.onAbort?.()
      else await options.agentLifecycle?.onError?.(error)
      throw error
    }
  }

  async paint(): Promise<string[]> {
    throw new Error('local_model_image_generation_unsupported')
  }
}
