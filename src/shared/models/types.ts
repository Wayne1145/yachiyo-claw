import type { ModelMessage, TextStreamPart, ToolSet } from 'ai'
import {
  type MessageContentParts,
  type MessageStatus,
  type ProviderOptions,
  ProviderOptionsSchema,
  type StreamTextResult,
  type ToolUseScope,
} from 'src/shared/types'
import { z } from 'zod'

export interface ModelInterface {
  name: string
  modelId: string
  isSupportVision(): boolean
  isSupportToolUse(scope?: ToolUseScope): boolean
  isSupportSystemMessage(): boolean
  chat: (messages: ModelMessage[], options: CallChatCompletionOptions) => Promise<StreamTextResult>
  chatStream: (messages: ModelMessage[], options: ChatStreamOptions) => AsyncGenerator<ModelStreamPart>
  paint: (
    params: {
      prompt: string
      images?: { imageUrl: string }[]
      num: number
      aspectRatio?: string
    },
    signal?: AbortSignal,
    callback?: (picBase64: string) => void | Promise<void>,
  ) => Promise<string[]>
}

export const CallChatCompletionOptionsSchema = z.object({
  sessionId: z.string().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  onResultChange: z.custom<OnResultChange>().optional(),
  tools: z.custom<ToolSet>().optional(),
  providerOptions: ProviderOptionsSchema.optional(),
  maxSteps: z.number().int().positive().optional(),
  maxModelRequests: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  agentMode: z.boolean().optional(),
  onAgentRequest: z.custom<(stepNumber: number) => void>().optional(),
  /** Restrict the model-visible tool schema for the current step. */
  activeTools: z.array(z.string().min(1).max(120)).max(64).optional(),
  agentLifecycle: z.custom<AgentLifecycle>().optional(),
})

export interface AgentRequestEvent {
  stepNumber: number
  messages: ModelMessage[]
  tools?: ToolSet
  activeTools?: string[]
}

export interface AgentStepFinishEvent {
  stepNumber: number
  usage?: unknown
  result?: unknown
}

export interface AgentFinishEvent {
  usage?: unknown
  result?: unknown
}

export interface AgentLifecycle {
  beforeRequest?: (event: AgentRequestEvent) => void | Promise<void>
  onStepFinish?: (event: AgentStepFinishEvent) => void | Promise<void>
  onFinish?: (event: AgentFinishEvent) => void | Promise<void>
  onAbort?: () => void | Promise<void>
  onError?: (error: unknown) => void | Promise<void>
}

export interface CallChatCompletionOptions<Tools extends ToolSet = ToolSet> {
  sessionId?: string
  signal?: AbortSignal
  onResultChange?: OnResultChange
  onStatusChange?: OnStatusChange
  tools?: Tools
  providerOptions?: ProviderOptions
  maxSteps?: number
  maxModelRequests?: number
  maxOutputTokens?: number
  /** Applies bounded steps, output, and billing-safe retry behavior for device tasks. */
  agentMode?: boolean
  /** Called immediately before each billable Agent model request. */
  onAgentRequest?: (stepNumber: number) => void | Promise<void>
  /** Restrict the model-visible tool schema for the current step. */
  activeTools?: string[]
  agentLifecycle?: AgentLifecycle
}

export interface ResultChange {
  // webBrowsing?: MessageWebBrowsing
  // reasoningContent?: string
  // toolCalls?: MessageToolCalls
  contentParts?: MessageContentParts
  tokenCount?: number // 当前消息的 token 数量
  tokensUsed?: number // 生成当前消息的 token 使用量
}

export type OnResultChangeWithCancel = (data: ResultChange & { cancel?: () => void }) => void
export type OnResultChange = (data: ResultChange) => void
export type OnStatusChange = (status: MessageStatus | null) => void

// New types for chatStream() API
export interface ChatStreamOptions {
  sessionId?: string
  signal?: AbortSignal
  tools?: ToolSet
  providerOptions?: ProviderOptions
  maxSteps?: number
  maxModelRequests?: number
  maxOutputTokens?: number
  /** Applies bounded steps, output, and billing-safe retry behavior for device tasks. */
  agentMode?: boolean
  /** Called immediately before each billable Agent model request. */
  onAgentRequest?: (stepNumber: number) => void | Promise<void>
  /** Restrict the model-visible tool schema for the current step. */
  activeTools?: string[]
  agentLifecycle?: AgentLifecycle
}

export type ModelStatus = MessageStatus

// ModelStreamPart extends AI SDK's TextStreamPart with custom status events
export type ModelStreamPart<T extends ToolSet = ToolSet> = TextStreamPart<T> | { type: 'status'; status: MessageStatus }
