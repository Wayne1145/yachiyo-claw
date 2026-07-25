import { asSchema, type ModelMessage, type Tool, type ToolSet } from 'ai'
import type { ProviderModelInfo, StreamTextResult } from '../../../types'
import type { ModelDependencies } from '../../../types/adapters'
import type {
  CallChatCompletionOptions,
  ChatStreamOptions,
  ModelInterface,
  ModelStreamPart,
} from '../../../models/types'
import { selectAndroidActiveTools } from '../../../agent/android-tool-stages'

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
    return true
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
    if (!adapter) throw new Error('local_model_not_available:local_inference_adapter_missing')
    const availability = adapter.checkAvailability
      ? await adapter.checkAvailability(this.modelId)
      : { available: await adapter.isAvailable(this.modelId) }
    if (!availability.available) {
      throw new Error(`local_model_not_available:${availability.reason || 'local_model_health_check_failed'}`)
    }

    const conversation = [...messages]
    const requestedSteps = options.maxSteps ?? (options.agentMode ? 24 : 8)
    const maxSteps = Math.min(Math.max(Math.min(requestedSteps, options.maxModelRequests ?? requestedSteps), 1), 64)
    const allTools = options.tools as T | undefined
    const usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
    let stepNumber = 0
    try {
      while (stepNumber < maxSteps) {
        const activeTools = options.agentMode && options.activeTools?.length
          ? selectAndroidActiveTools(stepNumber, conversation, options.activeTools)
          : options.activeTools
        const visibleTools = filterTools(allTools, activeTools)
        await options.onAgentRequest?.(stepNumber)
        await options.agentLifecycle?.beforeRequest?.({
          stepNumber,
          messages: conversation,
          tools: visibleTools,
          activeTools,
        })

        let responseText = ''
        let toolCall: { name: string; arguments: unknown; callId: string } | undefined
        for await (const event of adapter.stream(this.modelId, {
          messages: conversation,
          tools: visibleTools,
          maxTokens: options.maxOutputTokens,
          signal: options.signal,
        })) {
          if (event.type === 'text' && event.text) {
            responseText += event.text
            yield { type: 'text-delta', id: `local-${this.modelId}-${stepNumber}`, text: event.text } as ModelStreamPart<T>
          } else if (event.type === 'tool-call' && !toolCall) {
            toolCall = event
          } else if (event.type === 'status') {
            yield { type: 'status', status: event.status as never } as ModelStreamPart<T>
          }
        }

        if (!toolCall) {
          await options.agentLifecycle?.onStepFinish?.({ stepNumber, usage, result: { text: responseText } })
          yield { type: 'finish', finishReason: 'stop', totalUsage: usage } as ModelStreamPart<T>
          await options.agentLifecycle?.onFinish?.({ usage, result: { text: responseText, local: true } })
          return
        }

        const tool = visibleTools?.[toolCall.name] as Tool<unknown, unknown> | undefined
        const callChunk = {
          type: 'tool-call' as const,
          toolCallId: toolCall.callId,
          toolName: toolCall.name,
          input: toolCall.arguments,
          dynamic: !tool,
        }
        yield callChunk as ModelStreamPart<T>

        let output: unknown
        let toolError: unknown
        try {
          if (!tool?.execute) throw new Error(`local_model_tool_unavailable:${toolCall.name}`)
          const schema = asSchema(tool.inputSchema)
          const validation = schema.validate ? await schema.validate(toolCall.arguments) : { success: true as const, value: toolCall.arguments }
          if (!validation.success) throw validation.error
          output = await collectToolOutput(
            tool.execute(validation.value, {
              toolCallId: toolCall.callId,
              messages: conversation,
              abortSignal: options.signal,
            }),
          )
          yield {
            type: 'tool-result',
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: validation.value,
            output,
            dynamic: !tool,
          } as ModelStreamPart<T>
        } catch (error) {
          toolError = error
          output = { error: error instanceof Error ? error.message : String(error) }
          yield {
            type: 'tool-error',
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            input: toolCall.arguments,
            error,
            dynamic: !tool,
          } as ModelStreamPart<T>
        }

        conversation.push({
          role: 'assistant',
          content: [
            ...(responseText ? [{ type: 'text' as const, text: responseText }] : []),
            { type: 'tool-call', toolCallId: toolCall.callId, toolName: toolCall.name, input: toolCall.arguments },
          ],
        } as ModelMessage)
        conversation.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: toolCall.callId,
              toolName: toolCall.name,
              output,
            },
          ],
        } as ModelMessage)
        await options.agentLifecycle?.onStepFinish?.({
          stepNumber,
          usage,
          result: {
            text: responseText,
            toolCalls: [callChunk],
            toolResults: toolError ? [] : [{ toolCallId: toolCall.callId, toolName: toolCall.name, output }],
          },
        })
        stepNumber += 1
      }

      throw new Error(`local_model_agent_step_limit:${maxSteps}`)
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

function filterTools<T extends ToolSet>(tools: T | undefined, activeTools?: string[]): T | undefined {
  if (!tools || !activeTools?.length) return tools
  const allowed = new Set(activeTools)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name))) as T
}

async function collectToolOutput(value: unknown): Promise<unknown> {
  const resolved = await value
  if (!resolved || typeof resolved !== 'object' || !(Symbol.asyncIterator in resolved)) return resolved
  const outputs: unknown[] = []
  for await (const item of resolved as AsyncIterable<unknown>) outputs.push(item)
  return outputs.length <= 1 ? outputs[0] : outputs
}
