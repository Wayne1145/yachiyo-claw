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
    return this.model.capabilities?.includes('tool_use') || false
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

    const conversation = prepareLocalConversation(messages, this.model)
    const requestedSteps = options.maxSteps ?? (options.agentMode ? 24 : 8)
    const maxSteps = Math.min(Math.max(Math.min(requestedSteps, options.maxModelRequests ?? requestedSteps), 1), 64)
    const allTools = (this.isSupportToolUse() ? options.tools : undefined) as T | undefined
    const usage = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined }
    let stepNumber = 0
    try {
      while (stepNumber < maxSteps) {
        const activeTools = options.agentMode && options.activeTools?.length
          ? selectAndroidActiveTools(stepNumber, conversation, options.activeTools)
          : options.activeTools
        const visibleTools = limitToolsForSmallLocalModel(
          filterTools(allTools, activeTools),
          conversation,
          this.model,
        )
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

function limitToolsForSmallLocalModel<T extends ToolSet>(
  tools: T | undefined,
  messages: ModelMessage[],
  model: ProviderModelInfo,
): T | undefined {
  if (!tools || !isSubOneBillionModel(model.modelId)) return tools
  const entries = Object.entries(tools)
  if (entries.length <= 1) return tools

  const latestUserText = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  const query = modelMessageText(latestUserText || ({ role: 'user', content: '' } as ModelMessage)).toLowerCase()
  const ranked = entries
    .map(([name, definition], index) => ({
      name,
      definition,
      index,
      score: localToolRelevance(name, definition, query),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 1)
  return Object.fromEntries(ranked.map(({ name, definition }) => [name, definition])) as T
}

function localToolRelevance(name: string, definition: unknown, query: string): number {
  const normalizedName = name.toLowerCase()
  let score = query.includes(normalizedName) ? 10_000 : 0
  const nameTokens = normalizedName.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 2)
  for (const token of nameTokens) if (query.includes(token)) score += 250

  const description =
    definition && typeof definition === 'object' && 'description' in definition
      ? String((definition as { description?: unknown }).description || '').toLowerCase()
      : ''
  for (const token of description.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 3)) {
    if (query.includes(token)) score += 10
  }
  return score
}

async function collectToolOutput(value: unknown): Promise<unknown> {
  const resolved = await value
  if (!resolved || typeof resolved !== 'object' || !(Symbol.asyncIterator in resolved)) return resolved
  const outputs: unknown[] = []
  for await (const item of resolved as AsyncIterable<unknown>) outputs.push(item)
  return outputs.length <= 1 ? outputs[0] : outputs
}

function prepareLocalConversation(messages: ModelMessage[], model: ProviderModelInfo): ModelMessage[] {
  if (!isSubOneBillionModel(model.modelId)) return [...messages]
  const toolMode = model.capabilities?.includes('tool_use') || false

  return messages.map((message) => {
    if (message.role !== 'system') return message
    const original = modelMessageText(message)
    const identity = original.match(/你是([^。\n_]{1,32})/)?.[1]?.trim() || 'Yachiyo'
    const compactPrompt = toolMode
      ? [
          `You are ${identity}, a tool-using on-device agent.`,
          'Follow the latest user instruction directly.',
          'When a provided tool can fulfill the request, call the single visible tool with valid arguments.',
          'Never invent tool results. After the app returns a tool result, use it in a concise final answer.',
        ].join(' ')
      : [
          `You are ${identity}, a calm and accurate assistant.`,
          'Follow the latest user instruction directly and answer in the language the user requests.',
          'Always return visible plain text. Never answer with only whitespace or Markdown fences.',
          'Be concise because you are running as a small on-device model.',
        ].join(' ')
    return { ...message, content: compactPrompt } as ModelMessage
  })
}

function isSubOneBillionModel(modelId: string): boolean {
  const matches = [...modelId.matchAll(/(?:^|[-_/.])(\d+(?:\.\d+)?)\s*([mb])(?=$|[-_/.])/gi)]
  return matches.some((match) => {
    const value = Number.parseFloat(match[1])
    return Number.isFinite(value) && (match[2].toLowerCase() === 'm' ? value < 1000 : value < 1)
  })
}

function modelMessageText(message: ModelMessage): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => {
      return Boolean(part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    })
    .map((part) => part.text)
    .join('\n')
}
