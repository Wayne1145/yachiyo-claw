import type { CompactionPoint, Message } from '@shared/types'
import { useMemo } from 'react'
import { computeContextAfterCompaction } from '@/packages/context-management'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'

export interface UseTaskContextTokensOptions {
  taskId: string
  messages: Message[]
  model?: { provider: string; modelId: string }
  compactionPoints?: CompactionPoint[]
}

export interface UseTaskContextTokensResult {
  contextTokens: number
  currentInputTokens: number
  totalTokens: number
  isCalculating: boolean
  pendingTasks: number
  messageCount: number
}

export function useTaskContextTokens(options: UseTaskContextTokensOptions): UseTaskContextTokensResult {
  const { taskId, messages, model, compactionPoints } = options

  const contextMessages = useMemo(() => {
    if (messages.length === 0) {
      return []
    }

    const completedMessages = messages.filter((m) => !m.generating)
    if (completedMessages.length === 0) {
      return []
    }

    const compactedMessages = computeContextAfterCompaction(completedMessages, compactionPoints)
    return compactedMessages.filter((m) => !m.error && !m.errorCode)
  }, [messages, compactionPoints])

  const shouldEstimate = Boolean(model) && contextMessages.length > 0

  const tokenResult = useTokenEstimation({
    sessionId: shouldEstimate ? taskId : null,
    constructedMessage: undefined,
    contextMessages: shouldEstimate ? contextMessages : [],
    model,
    modelSupportToolUseForFile: false,
  })

  if (!shouldEstimate) {
    return {
      contextTokens: 0,
      currentInputTokens: 0,
      totalTokens: 0,
      isCalculating: false,
      pendingTasks: 0,
      messageCount: contextMessages.length,
    }
  }

  return {
    contextTokens: tokenResult.contextTokens,
    currentInputTokens: tokenResult.currentInputTokens,
    totalTokens: tokenResult.totalTokens,
    isCalculating: tokenResult.isCalculating,
    pendingTasks: tokenResult.pendingTasks,
    messageCount: contextMessages.length,
  }
}
