import type { Message } from '@shared/types/session'
import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeTokenRequirements } from '../analyzer'
import { computationQueue, generateTaskId } from '../computation-queue'
import { getTokenizerType } from '../tokenizer'
import type { TokenEstimationResult } from '../types'

export interface UseTokenEstimationOptions {
  sessionId: string | null
  constructedMessage: Message | undefined
  contextMessages: Message[]
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
}

export function useTokenEstimation(options: UseTokenEstimationOptions): TokenEstimationResult {
  const { sessionId, constructedMessage, contextMessages, model, modelSupportToolUseForFile } = options

  const tokenizerType = useMemo(() => getTokenizerType(model), [model])

  const [queueStatus, setQueueStatus] = useState({ pending: 0, running: 0 })
  const lastInvalidatedTaskSignature = useRef<string>('')

  useEffect(() => {
    const updateStatus = () => {
      if (sessionId && sessionId !== 'new') {
        setQueueStatus(computationQueue.getStatusForSession(sessionId))
      } else {
        setQueueStatus({ pending: 0, running: 0 })
      }
    }
    updateStatus()
    return computationQueue.subscribe(updateStatus)
  }, [sessionId])

  const analysisResult = useMemo(
    () =>
      analyzeTokenRequirements({
        constructedMessage,
        contextMessages,
        tokenizerType,
        modelSupportToolUseForFile,
      }),
    [constructedMessage, contextMessages, tokenizerType, modelSupportToolUseForFile]
  )

  const contextMessageIds = useMemo(() => new Set(contextMessages.map((m) => m.id)), [contextMessages])

  const pendingTaskIds = useMemo(() => {
    if (!sessionId || sessionId === 'new') return []
    return analysisResult.pendingTasks.map((task) =>
      generateTaskId({
        ...task,
        sessionId,
      })
    )
  }, [analysisResult.pendingTasks, sessionId])

  useEffect(() => {
    if (!sessionId || sessionId === 'new') return

    const pendingTaskSignature = pendingTaskIds.join('|')
    if (pendingTaskIds.length > 0 && pendingTaskSignature !== lastInvalidatedTaskSignature.current) {
      computationQueue.invalidateCompletedTasks(pendingTaskIds)
      lastInvalidatedTaskSignature.current = pendingTaskSignature
    }

    if (pendingTaskIds.length === 0) {
      lastInvalidatedTaskSignature.current = ''
    }

    // Cancel tasks for messages no longer in context (e.g., maxContextMessageCount changed)
    computationQueue.retainOnlyMessages(sessionId, contextMessageIds)

    // Cancel tasks with old tokenizerType when model changes
    computationQueue.retainOnlyTokenizerType(sessionId, tokenizerType)

    if (analysisResult.pendingTasks.length === 0) return

    computationQueue.enqueueBatch(
      analysisResult.pendingTasks.map((task) => ({
        ...task,
        sessionId,
      }))
    )
  }, [sessionId, contextMessageIds, analysisResult.pendingTasks, pendingTaskIds, tokenizerType])

  useEffect(() => {
    return () => {
      if (sessionId && sessionId !== 'new') {
        computationQueue.cancelBySession(sessionId)
      }
    }
  }, [sessionId])

  return {
    currentInputTokens: analysisResult.currentInputTokens,
    contextTokens: analysisResult.contextTokens,
    totalTokens: analysisResult.currentInputTokens + analysisResult.contextTokens,
    isCalculating: queueStatus.pending > 0 || queueStatus.running > 0 || analysisResult.pendingTasks.length > 0,
    pendingTasks: queueStatus.pending + queueStatus.running,
    breakdown: analysisResult.breakdown,
  }
}
