import * as defaults from '@shared/defaults'
import type { ChatStreamOptions, ModelStreamPart } from '@shared/models/types'
import { createMessage, type Message, ModelProviderEnum, type TaskSession } from '@shared/types'
import { getMessageText, sequenceMessages } from '@shared/utils/message'
import type { ToolSet } from 'ai'
import { createModel, createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { cancelPendingAgentApprovals, requestAgentApproval, setActiveAgentSession } from '@/mobile/agent-approval'
import {
  AgentBudgetExceededError,
  AgentBudgetTracker,
  KNOWN_PRICE_AGENT_BUDGET,
  UNKNOWN_PRICE_AGENT_BUDGET,
} from '@/mobile/agent-budget'
import { createAgentRunId, shouldUseDeviceAgent } from '@/mobile/agent-run-policy'
import { getAgentSessionConfig } from '@/mobile/agent-session-config'
import { tryRunLocalAndroidRecipe } from '@/mobile/android-task-recipe'
import {
  AgentUsageBudgetExceededError,
  AgentUnknownPriceError,
  createAgentUsageLedger,
  resolveDefaultAgentPrice,
} from '@/mobile/agent-usage-ledger'
import { buildAgentIdentityPrompt } from '@/mobile/agent-profile'
import { getAgentRuntimeSettings } from '@/mobile/agent-runtime-settings'
import { nextAgentStreamPart } from '@/mobile/agent-stream-watchdog'
import { convertToModelMessages, injectModelSystemPrompt } from '@/packages/model-calls/message-utils'
import { onAndroidDeviceOperation } from '@/packages/model-calls/toolsets/android-device'
import platform from '@/platform'
import { resetSemanticObservationCache, yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { featureFlags } from '@/utils/feature-flags'
import { lastUsedModelStore } from './lastUsedModelStore'
import { queryClient } from './queryClient'
import { createInitialState, processStreamChunk } from './session/stream-chunk-processor'
import { buildToolsForSession } from './session/tools-builder'
import { settingsStore } from './settingsStore'
import { TASK_SESSION_QUERY_KEY, updateTaskSession } from './taskSessionStore'
import { buildTaskSystemPrompt } from './taskSystemPrompt'

const log = getLogger('task-session-actions')
const AGENT_STREAM_IDLE_TIMEOUT_MS = 180_000

// Note: Using a single module-level AbortController means only one task can generate at a time.
// This is intentional — prevents resource contention in the sandbox environment.
// If concurrent task generation is needed in the future, replace with a Map<taskId, AbortController>.
let currentAbortController: AbortController | null = null
let currentAgentRunId: string | null = null

export function isTaskGenerating(): boolean {
  return currentAbortController !== null
}

async function clearTaskGeneratingState(taskId: string): Promise<void> {
  const queryKey = [TASK_SESSION_QUERY_KEY, taskId]
  const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (!currentSession) {
    return
  }
  let changed = false
  const messages = currentSession.messages.map((msg) => {
    if (!msg.generating) {
      return msg
    }
    changed = true
    return {
      ...msg,
      generating: false,
      cancel: undefined,
    }
  })

  if (!changed) {
    return
  }

  const persisted = await updateTaskSession(taskId, { messages })
  if (persisted) {
    queryClient.setQueryData(queryKey, persisted)
  } else {
    queryClient.setQueryData(queryKey, { ...currentSession, messages })
  }
}

export async function cancelTaskGeneration(taskId?: string): Promise<void> {
  const agentRunId = currentAgentRunId
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  cancelPendingAgentApprovals(agentRunId || taskId)
  if (platform.type !== 'mobile') {
    try {
      await platform.sandboxKill?.()
    } catch (err) {
      log.debug('sandbox kill during cancellation:', err)
    }
  }
  if (taskId) {
    await clearTaskGeneratingState(taskId)
  }
}

export async function submitTaskMessage(taskId: string, content: string): Promise<void> {
  setActiveAgentSession(taskId)
  const queryKey = [TASK_SESSION_QUERY_KEY, taskId]
  let currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (!currentSession) {
    log.error('Task session not found:', taskId)
    return
  }
  const deviceAgent = shouldUseDeviceAgent(platform.type, getAgentSessionConfig(taskId).deviceControlEnabled)

  try {
    const { runTaskCompaction } = await import('./taskCompaction')
    await runTaskCompaction(taskId)
    currentSession = queryClient.getQueryData<TaskSession>(queryKey) ?? currentSession
  } catch (err) {
    log.error('Task compaction failed:', err)
  }

  const userMessage: Message = createMessage('user', content)

  const messagesWithUser = [...currentSession.messages, userMessage]
  const updated = await updateTaskSession(taskId, { messages: messagesWithUser })
  if (updated) {
    queryClient.setQueryData(queryKey, updated)
  } else {
    // Persist failed but update cache optimistically so UI stays consistent
    queryClient.setQueryData(queryKey, { ...currentSession, messages: messagesWithUser })
  }

  const assistantMessage: Message = createMessage('assistant', '')
  assistantMessage.generating = true

  const messagesWithAssistant = [...messagesWithUser, assistantMessage]
  const updated2 = await updateTaskSession(taskId, { messages: messagesWithAssistant })
  if (updated2) {
    queryClient.setQueryData(queryKey, updated2)
  } else {
    // Persist failed but update cache optimistically so UI stays consistent
    queryClient.setQueryData(queryKey, { ...currentSession, messages: messagesWithAssistant })
  }

  // A confirmed local recipe is resolved before constructing a model or
  // opening a stream. This is the zero-request path for repeated Android work.
  if (deviceAgent) {
    try {
      const localOutcome = await tryRunLocalAndroidRecipe(taskId, content)
      if (localOutcome.handled) {
        const localMessage: Message = {
          ...assistantMessage,
          generating: false,
          cancel: undefined,
          status: [],
          contentParts: [{ type: 'text', text: localOutcome.message || '本地流程已完成。' }],
        }
        const localSession = queryClient.getQueryData<TaskSession>(queryKey)
        if (localSession) {
          const localMessages = localSession.messages.map((message) =>
            message.id === assistantMessage.id ? localMessage : message,
          )
          const persisted = await updateTaskSession(taskId, { messages: localMessages })
          queryClient.setQueryData(queryKey, persisted || { ...localSession, messages: localMessages })
          if (persisted) {
            const { syncTaskSessionToChat } = await import('@/mobile/conversation-sync')
            await syncTaskSessionToChat(persisted)
          }
        }
        return
      }
    } catch (error) {
      // A malformed/stale recipe must never prevent the normal model fallback.
      log.debug('local Android recipe skipped:', error)
    }
  }

  await generateTaskResponse(taskId, assistantMessage, messagesWithUser)
}

function getDefaultModelSettings(sessionSettings?: { provider?: string; modelId?: string }) {
  // 1. Session-level settings (highest priority)
  if (sessionSettings?.provider && sessionSettings?.modelId) {
    return { provider: sessionSettings.provider, modelId: sessionSettings.modelId }
  }
  // 2. Last used task model
  const lastUsedTask = lastUsedModelStore.getState().task
  if (lastUsedTask?.provider && lastUsedTask?.modelId) {
    return { provider: lastUsedTask.provider, modelId: lastUsedTask.modelId }
  }
  // 3. Default chat model (from global settings)
  const settings = settingsStore.getState().getSettings()
  const defaultChat = settings.defaultChatModel
  if (defaultChat?.provider && defaultChat?.model) {
    return { provider: defaultChat.provider, modelId: defaultChat.model }
  }
  // 4. Last used chat model (lowest priority fallback)
  const lastUsedChat = lastUsedModelStore.getState().chat
  if (lastUsedChat?.provider && lastUsedChat?.modelId) {
    return { provider: lastUsedChat.provider, modelId: lastUsedChat.modelId }
  }
  throw new Error('No AI model configured. Please set a default chat model in Settings or start a normal chat first.')
}

async function generateTaskResponse(taskId: string, targetMsg: Message, contextMessages: Message[]): Promise<void> {
  const queryKey = [TASK_SESSION_QUERY_KEY, taskId]
  const abortController = new AbortController()
  const deviceAgent = shouldUseDeviceAgent(platform.type, getAgentSessionConfig(taskId).deviceControlEnabled)
  // Scope persisted Broker checkpoints to one generated task message. A later
  // user request in the same session must be allowed to perform the same
  // legitimate action again, while retries of this message remain idempotent.
  const agentRunId = createAgentRunId(taskId, targetMsg.id)
  let budget: AgentBudgetTracker | null = null
  if (deviceAgent) resetSemanticObservationCache(agentRunId)
  currentAbortController = abortController
  currentAgentRunId = agentRunId
  let overlayStopListener: Awaited<ReturnType<typeof yachiyoDeviceAccessNative.onOverlayStopRequested>> | undefined
  let overlayVisible = false
  let overlayStartPromise: Promise<void> | undefined
    let removeDeviceOperationListener: (() => void) | undefined
    let completedSuccessfully = false
    let sandboxEnabled = true
    let sandboxUnavailableReason = ''
  let usageReservations = new Map<number, string>()
  let settlePendingUsage: (usage?: unknown, result?: unknown) => Promise<void> = async () => undefined

  try {
    const session = queryClient.getQueryData<TaskSession>(queryKey)
    const { provider, modelId } = getDefaultModelSettings(session?.settings)
    const sessionSettings = {
      ...defaults.chatSessionSettings(),
      provider,
      modelId,
    }
    const dependencies = await createModelDependencies()
    const model = await createModel(sessionSettings, dependencies)
    const knownPrice = deviceAgent ? resolveDefaultAgentPrice(provider, modelId) : undefined
    const agentLimits = knownPrice ? KNOWN_PRICE_AGENT_BUDGET : UNKNOWN_PRICE_AGENT_BUDGET
    if (deviceAgent) budget = new AgentBudgetTracker(agentLimits)
    const usageLedger = deviceAgent
      ? createAgentUsageLedger({
          budget: {
            maxTokens: agentLimits.maxTokens,
            maxModelRequests: agentLimits.maxModelRequests,
            ...(agentLimits.maxCostUsd !== undefined ? { maxCostUsd: agentLimits.maxCostUsd } : {}),
          },
          priceResolver: () => knownPrice,
          requirePriceConfirmation: !knownPrice,
          confirmUnknownPrice: ({ provider: unknownProvider, model: unknownModel, reservedTokens }) =>
            requestAgentApproval({
              sessionId: taskId,
              runId: agentRunId,
              signal: abortController.signal,
              title: '模型价格未知，是否继续？',
              detail: `${unknownProvider}/${unknownModel}，最多预留 ${reservedTokens} tokens`,
              risk: 'dangerous',
            }),
        })
      : null
    await usageLedger?.recoverPendingReservations(Date.now(), agentRunId)
    usageReservations = new Map<number, string>()
    settlePendingUsage = async (usage?: unknown, result?: unknown) => {
      if (!usageLedger) return
      for (const [stepNumber, reservationId] of usageReservations) {
        const settled = await usageLedger
          .settle(reservationId, { usage: usage as Record<string, unknown> | undefined, result })
          .catch(() => undefined)
        if (settled?.costUsd !== undefined) budget?.recordCost(settled.costUsd)
        usageReservations.delete(stepNumber)
      }
    }
    if (deviceAgent) {
      removeDeviceOperationListener = onAndroidDeviceOperation(async () => {
        try {
          budget?.reserveLocalAction()
        } catch (error) {
          abortController.abort()
          throw error
        }
        if (overlayVisible) return overlayStartPromise
        overlayVisible = true
        overlayStartPromise = (async () => {
          overlayStopListener = await yachiyoDeviceAccessNative.onOverlayStopRequested(() => abortController.abort())
          await yachiyoDeviceAccessNative.showOperationOverlay('').catch(() => undefined)
        })()
        await overlayStartPromise
      })
    }
    if (session?.workingDirectory && platform.sandboxInit) {
      try {
        const sandboxStatus = platform.type === 'mobile' ? await platform.sandboxStatus?.() : undefined
        if (sandboxStatus && sandboxStatus.state !== 'ready') {
          sandboxEnabled = false
          sandboxUnavailableReason = `sandbox_${sandboxStatus.state}`
        } else {
          const initResult = await platform.sandboxInit({ workingDirectory: session.workingDirectory })
          if (!initResult.success) {
            sandboxEnabled = false
            sandboxUnavailableReason = initResult.error || 'sandbox_initialization_failed'
          }
        }
      } catch (error) {
        sandboxEnabled = false
        sandboxUnavailableReason = error instanceof Error ? error.message : 'sandbox_initialization_failed'
      }
    }

    let filteredContext = contextMessages
    if (session?.compactionPoints?.length) {
      try {
        const { buildContext } = await import('@shared/context')
        const noopResolver = { read: async () => null }
        filteredContext = await buildContext(contextMessages, {
          attachmentResolver: noopResolver,
          compactionPoints: session.compactionPoints,
          keepToolCallRounds: 2,
        })
      } catch (err) {
        log.error('Context filtering failed, using raw messages:', err)
      }
    }

    const workingDir = session?.workingDirectory || '.'
    const systemMessage: Message = createMessage(
      'system',
      buildTaskSystemPrompt(workingDir, {
        agentIdentity: buildAgentIdentityPrompt(),
        deviceAgent,
      }),
    )

    const promptMessages = [systemMessage, ...filteredContext]

    const skillSettings = settingsStore.getState().getSettings().skills
    const enabledSkillNames = featureFlags.skills ? skillSettings.enabledSkillNames : []

    const { tools, instructions, activeTools } = await buildToolsForSession(model, {
      webBrowsing: true,
      messages: promptMessages,
      sandboxEnabled,
      enabledSkillNames,
      agentSessionId: deviceAgent ? agentRunId : taskId,
      agentApprovalSessionId: deviceAgent ? taskId : undefined,
      cameraSessionId: taskId,
      deviceControlEnabled: deviceAgent,
    })

    const runtimeInstructions = sandboxUnavailableReason
      ? `${instructions}\n<sandbox_status>The local Linux sandbox is unavailable for this turn (${sandboxUnavailableReason}). Do not claim to run sandbox commands or skill scripts. Continue with other available tools and explain the limitation only when it affects the request.</sandbox_status>`
      : instructions

    let injectedMessages = injectModelSystemPrompt(
      model.modelId,
      promptMessages,
      runtimeInstructions,
      model.isSupportSystemMessage() ? 'system' : 'user',
    )

    if (!model.isSupportSystemMessage()) {
      injectedMessages = injectedMessages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
    }

    injectedMessages = sequenceMessages(injectedMessages)

    const coreMessages = await convertToModelMessages(injectedMessages, {
      modelSupportVision: model.isSupportVision(),
      preserveReasoning: provider === ModelProviderEnum.DeepSeek,
    })

    targetMsg = {
      ...targetMsg,
      cancel: () => abortController.abort(),
    }
    updateTaskQueryCache(queryKey, targetMsg)

    const chatOptions: ChatStreamOptions = {
      sessionId: taskId,
      signal: abortController.signal,
      // A task session is always an Agent loop; phone control only changes which tools are exposed.
      agentMode: true,
      ...(activeTools ? { activeTools } : {}),
      ...(deviceAgent
        ? {
            maxSteps: agentLimits.maxModelRequests,
            maxModelRequests: agentLimits.maxModelRequests,
            maxOutputTokens: agentLimits.maxOutputTokens,
            onAgentRequest: () => budget?.reserveModelRequest(),
            agentLifecycle: {
              beforeRequest: async ({ stepNumber, messages, tools: toolDefinitions, activeTools: visibleTools }) => {
                if (!usageLedger) return
                const filteredTools = visibleTools?.length
                  ? Object.fromEntries(
                      visibleTools
                        .map((name) => [name, toolDefinitions?.[name]] as const)
                        .filter(([, value]) => Boolean(value)),
                    )
                  : toolDefinitions
                const reservation = await usageLedger.reserve({
                  provider,
                  model: modelId,
                  taskId: agentRunId,
                  requestId: `${agentRunId}:request:${stepNumber + 1}`,
                  attempt: stepNumber + 1,
                  messages,
                  tools: filteredTools,
                  results: messages.filter((message) => message.role === 'tool'),
                  maxOutputTokens: agentLimits.maxOutputTokens,
                  maxReasoningTokens: Math.floor(agentLimits.maxOutputTokens / 2),
                  budget: {
                    maxTokens: agentLimits.maxTokens,
                    maxModelRequests: agentLimits.maxModelRequests,
                    ...(agentLimits.maxCostUsd !== undefined ? { maxCostUsd: agentLimits.maxCostUsd } : {}),
                  },
                  price: knownPrice,
                })
                usageReservations.set(stepNumber, reservation.reservationId)
              },
              onStepFinish: async ({ stepNumber, usage, result }) => {
                const reservationId = usageReservations.get(stepNumber)
                if (!reservationId || !usageLedger) return
                const settled = await usageLedger.settle(reservationId, {
                  usage: usage as Record<string, unknown> | undefined,
                  result,
                })
                if (settled.costUsd !== undefined) budget?.recordCost(settled.costUsd)
                usageReservations.delete(stepNumber)
              },
              onFinish: async ({ usage, result }) => settlePendingUsage(usage, result),
              onAbort: async () => settlePendingUsage(),
              onError: async () => settlePendingUsage(),
            },
          }
        : {}),
    }

    if (Object.keys(tools).length > 0) {
      chatOptions.tools = tools as ToolSet
    }

    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>

    let processorState = createInitialState()
    let lastOverlayUpdate = 0
    let accountedTokens = 0

    const streamCallbacks = {
      onFileReceived: (_mediaType: string, _base64: string) => Promise.resolve(''),
    }

    const iterator = stream[Symbol.asyncIterator]()
    while (true) {
      budget?.assertWithinDeadline()
      const next = await nextAgentStreamPart(
        iterator,
        budget ? Math.min(AGENT_STREAM_IDLE_TIMEOUT_MS, Math.max(1, budget.remainingMs)) : AGENT_STREAM_IDLE_TIMEOUT_MS,
        () => abortController.abort(),
      )
      if (next.done) break
      const chunk = next.value
      const result = await processStreamChunk(chunk, processorState, streamCallbacks)
      processorState = result.state

      const totalTokens = processorState.usage?.totalTokens
      if (budget && typeof totalTokens === 'number' && totalTokens > accountedTokens) {
        budget.recordTokens(totalTokens - accountedTokens)
        accountedTokens = totalTokens
      }

      if (result.skipUpdate) {
        if (result.statusChunk && result.statusChunk.type === 'status') {
          targetMsg = {
            ...targetMsg,
            status: result.statusChunk.status ? [result.statusChunk.status] : [],
          }
          updateTaskQueryCache(queryKey, targetMsg)
        }
        continue
      }

      const nextMsg: Message = {
        ...targetMsg,
        contentParts: [...processorState.contentParts],
      }

      const textLength = getMessageText(nextMsg, true, true).length
      targetMsg = {
        ...nextMsg,
        status: textLength > 0 ? [] : nextMsg.status,
      }

      updateTaskQueryCache(queryKey, targetMsg)
      if (deviceAgent && overlayVisible && Date.now() - lastOverlayUpdate >= 120) {
        lastOverlayUpdate = Date.now()
        void yachiyoDeviceAccessNative
          .updateOperationOverlay(getMessageText(targetMsg, true, true))
          .catch(() => undefined)
      }
    }

    for (const part of processorState.contentParts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = Date.now() - part.startTime
      }
    }

    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      contentParts: [...processorState.contentParts],
      status: [],
      finishReason: processorState.finishReason,
      usage: processorState.usage,
    }

    const finalSession = queryClient.getQueryData<TaskSession>(queryKey)
    if (finalSession) {
      const messages = finalSession.messages.map((m) => (m.id === targetMsg.id ? targetMsg : m))
      const persisted = await updateTaskSession(taskId, { messages })
      if (persisted) {
        queryClient.setQueryData(queryKey, persisted)
        const { syncTaskSessionToChat } = await import('@/mobile/conversation-sync')
        await syncTaskSessionToChat(persisted)
      }
    }
    completedSuccessfully = true
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.error('Task generation failed:', err)
    }
    const error =
      err instanceof AgentBudgetExceededError || err instanceof AgentUsageBudgetExceededError
        ? `任务已停止：${err.limit === 'deadline' ? '超过时间预算' : `超过${err.limit}预算`}`
        : err instanceof AgentUnknownPriceError
          ? '任务已停止：模型价格未知，未获得继续确认。'
          : abortController.signal.aborted
            ? undefined
            : err instanceof Error
              ? err.message
              : String(err)
    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      error,
    }
    const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
    if (currentSession) {
      const messages = currentSession.messages.map((m) => (m.id === targetMsg.id ? targetMsg : m))
      const persisted = await updateTaskSession(taskId, { messages })
      if (persisted) {
        queryClient.setQueryData(queryKey, persisted)
        const { syncTaskSessionToChat } = await import('@/mobile/conversation-sync')
        await syncTaskSessionToChat(persisted)
      }
    }
  } finally {
    if (currentAbortController === abortController) currentAbortController = null
    if (currentAgentRunId === agentRunId) currentAgentRunId = null
    setActiveAgentSession(null)
    cancelPendingAgentApprovals(agentRunId)
    abortController.abort()
    try {
      removeDeviceOperationListener?.()
    } catch (cleanupError) {
      log.debug('device operation listener cleanup failed:', cleanupError)
    }
    await overlayStopListener?.remove().catch((cleanupError) => {
      log.debug('overlay stop listener cleanup failed:', cleanupError)
    })
    if (deviceAgent && overlayVisible) {
      await yachiyoDeviceAccessNative.hideOperationOverlay().catch(() => undefined)
      if (completedSuccessfully && getAgentRuntimeSettings().returnToAppOnComplete) {
        await yachiyoDeviceAccessNative.bringAppToForeground().catch(() => undefined)
      }
    }
    await settlePendingUsage().catch(() => undefined)
    if (deviceAgent) resetSemanticObservationCache(agentRunId)
  }
}

function updateTaskQueryCache(queryKey: string[], targetMsg: Message): void {
  const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (currentSession) {
    const messages = currentSession.messages.map((m) => (m.id === targetMsg.id ? targetMsg : m))
    queryClient.setQueryData(queryKey, { ...currentSession, messages })
  }
}
