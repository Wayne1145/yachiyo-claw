import type { CompactionPoint, Message, Session, Settings } from '@shared/types'
import { useEffect, useMemo } from 'react'
import { getTokenizerType } from '@/packages/token-estimation'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'
import queryClient from '@/stores/queryClient'
import { selectMessagesForSendContext } from './attachment-payload'
import { buildContextForSession } from './context-builder'

// Set React Query defaults for context tokens cache
queryClient.setQueryDefaults(['context-tokens'], {
  staleTime: Infinity,
  gcTime: 60 * 60 * 1000, // 1 hour
})

/**
 * Options for useContextTokens hook
 */
export interface UseContextTokensOptions {
  sessionId: string | null
  session: Session | null | undefined
  settings: Partial<Settings>
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
  constructedMessage?: Message
}

/**
 * Result returned by useContextTokens hook
 */
export interface UseContextTokensResult {
  contextTokens: number
  messageCount: number
  currentInputTokens: number
  totalTokens: number
  isCalculating: boolean
  pendingTasks: number
}

/**
 * Parameters for generating context tokens cache key
 * NOTE: modelSupportToolUseForFile NOT included (Compaction can't access it)
 */
export interface ContextTokensCacheKeyParams {
  sessionId: string
  maxContextMessageCount: number
  latestContextMessageId: string | null
  latestCompactionBoundaryId: string | null
  tokenizerType: 'default' | 'deepseek'
}

/**
 * Value stored in context tokens cache
 */
export interface ContextTokensCacheValue {
  contextTokens: number // needsCompaction() reads this
  messageCount: number // for UI
  timestamp: number // for debugging
}

/**
 * Options for getContextMessagesForTokenEstimation
 */
export interface GetContextMessagesForTokenEstimationOptions {
  settings?: Partial<Settings>
  preserveLastUserMessage?: boolean
  keepToolCallRounds?: number
}

/**
 * Get context messages for token estimation
 *
 * Algorithm:
 * 1. Call buildContextForSession to get base context messages
 * 2. Apply selectMessagesForSendContext filtering:
 *    - Filter out error/errorCode messages
 *    - Filter out generating=true messages
 *    - Apply maxContextMessageCount limit
 *
 * @param session - The session to extract context from
 * @param options - Options including settings, preserveLastUserMessage, keepToolCallRounds
 * @returns Filtered messages for token estimation
 */
export function getContextMessagesForTokenEstimation(
  session: Session,
  options: GetContextMessagesForTokenEstimationOptions = {}
): Message[] {
  const { settings = {}, keepToolCallRounds = 2, preserveLastUserMessage = false } = options

  // Step 1: Call buildContextForSession to get base context messages
  const baseMessages = buildContextForSession(session, { keepToolCallRounds, settings })

  // Step 2: Apply selectMessagesForSendContext filtering
  // - Filter out error/errorCode messages
  // - Filter out generating=true messages
  // - Apply maxContextMessageCount limit
  // - CRITICAL: Pass compactionPoints for proper filtering after compaction
  const filteredMessages = selectMessagesForSendContext({
    settings,
    msgs: baseMessages,
    compactionPoints: session.compactionPoints,
    preserveLastUserMessage,
    keepToolCallRounds,
  })

  return filteredMessages
}

/**
 * Generate immutable cache key for context tokens
 *
 * Uses reduce (not sort) to find latest compaction boundary ID
 * to maintain immutability of input array
 *
 * @param params - Cache key parameters
 * @returns Immutable readonly tuple for React Query
 */
export function getContextTokensCacheKey(params: ContextTokensCacheKeyParams): readonly [string, ...unknown[]] {
  return [
    'context-tokens',
    params.sessionId,
    params.maxContextMessageCount,
    params.latestContextMessageId,
    params.latestCompactionBoundaryId,
    params.tokenizerType,
  ] as const
}

/**
 * Get the latest compaction boundary ID from compaction points
 *
 * Uses immutable reduce approach (not sort) to find the most recent
 * compaction point by createdAt timestamp
 *
 * @param compactionPoints - Array of compaction points
 * @returns The boundaryMessageId of the latest compaction point, or null
 */
export function getLatestCompactionBoundaryId(compactionPoints?: CompactionPoint[]): string | null {
  if (!compactionPoints?.length) return null

  return (
    compactionPoints.reduce(
      (latest, current) => (current.createdAt > (latest?.createdAt ?? 0) ? current : latest),
      undefined as CompactionPoint | undefined
    )?.boundaryMessageId ?? null
  )
}

/**
 * React Query cache layer for context tokens
 *
 * Caches context token calculations with dependencies on:
 * - sessionId, maxContextMessageCount, latestContextMessageId
 * - latestCompactionBoundaryId, tokenizerType
 *
 * Does NOT cache:
 * - currentInputTokens (changes with constructedMessage)
 * - totalTokens (derived from currentInputTokens + contextTokens)
 * - isCalculating (real-time queue status)
 * - pendingTasks (real-time queue status)
 */
export function useContextTokens(options: UseContextTokensOptions): UseContextTokensResult {
  const { sessionId, session, settings, model, modelSupportToolUseForFile, constructedMessage } = options

  // 1. contextMessages must be stable
  const contextMessages = useMemo(() => {
    if (!session) return []
    return getContextMessagesForTokenEstimation(session, { settings })
  }, [session?.messages, session?.compactionPoints, settings.maxContextMessageCount])

  // 2. tokenizerType must be stable
  const tokenizerType = useMemo(() => getTokenizerType(model), [model?.provider, model?.modelId])

  // 3. cacheKey must be stable (NO modelSupportToolUseForFile!)
  const cacheKey = useMemo(() => {
    if (!sessionId || sessionId === 'new' || !session) return null
    return getContextTokensCacheKey({
      sessionId,
      maxContextMessageCount: settings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER,
      latestContextMessageId: contextMessages[contextMessages.length - 1]?.id ?? null,
      latestCompactionBoundaryId: getLatestCompactionBoundaryId(session.compactionPoints),
      tokenizerType,
    })
  }, [sessionId, session?.compactionPoints, settings.maxContextMessageCount, contextMessages, tokenizerType])

  // 4. Call useTokenEstimation
  const tokenResult = useTokenEstimation({
    sessionId,
    constructedMessage,
    contextMessages,
    model,
    modelSupportToolUseForFile,
  })

  const isCalculating = tokenResult.isCalculating

  // 5. Read existing cache value (for recalculation consistency)
  const existingCacheValue = useMemo(() => {
    if (!cacheKey) return null
    return queryClient.getQueryData<ContextTokensCacheValue>(cacheKey) ?? null
  }, [cacheKey])

  // 6. New cache value (only when calculation complete)
  const newCacheValue = useMemo<ContextTokensCacheValue | null>(() => {
    if (!cacheKey || isCalculating) return null
    return {
      contextTokens: tokenResult.contextTokens,
      messageCount: contextMessages.length,
      timestamp: Date.now(),
    }
  }, [cacheKey, isCalculating, tokenResult.contextTokens, contextMessages.length])

  // 7. Write to cache when calculation completes
  useEffect(() => {
    if (!cacheKey || !newCacheValue) return
    queryClient.setQueryData(cacheKey, newCacheValue)
  }, [cacheKey, newCacheValue])

  // 8. Return with priority: newCacheValue > existingCacheValue > tokenResult
  return {
    contextTokens: newCacheValue?.contextTokens ?? existingCacheValue?.contextTokens ?? tokenResult.contextTokens,
    messageCount: newCacheValue?.messageCount ?? existingCacheValue?.messageCount ?? contextMessages.length,
    currentInputTokens: tokenResult.currentInputTokens,
    totalTokens: tokenResult.totalTokens,
    isCalculating: tokenResult.isCalculating,
    pendingTasks: tokenResult.pendingTasks,
  }
}
