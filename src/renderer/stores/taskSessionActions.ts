import * as defaults from '@shared/defaults'
import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import type { ChatStreamOptions, ModelStreamPart } from '@shared/models/types'
import { createMessage, type Message, ModelProviderEnum, type TaskSession } from '@shared/types'
import { getMessageText, sequenceMessages } from '@shared/utils/message'
import { resolveReasoningProviderOptions } from '@shared/utils/reasoning-strength'
import type { ToolSet } from 'ai'
import { createModel, createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import {
  isDeviceOperationOverlayVisible,
  registerBuiltinFeatureLifecycles,
  type SandboxRunState,
  updateDeviceOperationOverlay,
} from '@/features/builtin-lifecycles'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { beginAgentRun, type AgentRunLifecycleHandle } from '@/features/lifecycle-runner'
import {
  cancelPendingAgentApprovals,
  onAgentApprovalLifecycle,
  requestAgentDecision,
  setActiveAgentSession,
  setActiveAgentRun,
} from '@/mobile/agent-approval'
import { AgentLoopGuard, AgentLoopStoppedError } from '@/mobile/agent-loop-guard'
import { AgentRunCheckpointStore, type AgentRunCheckpoint } from '@/mobile/agent-run-checkpoints'
import { createAgentRunId, shouldUseDeviceAgent } from '@/mobile/agent-run-policy'
import { getAgentSessionConfig } from '@/mobile/agent-session-config'
import { tryRunLocalAndroidRecipe } from '@/mobile/android-task-recipe'
import { createAgentUsageLedger, resolveDefaultAgentPrice } from '@/mobile/agent-usage-ledger'
import { buildAgentIdentityPrompt } from '@/mobile/agent-profile'
import { buildRelevantLongTermMemoryPrompt, rememberDurableUserStatements } from '@/mobile/automatic-memory'
import { getAgentRuntimeSettings } from '@/mobile/agent-runtime-settings'
import { nextAgentStreamPart } from '@/mobile/agent-stream-watchdog'
import { convertToModelMessages, injectModelSystemPrompt } from '@/packages/model-calls/message-utils'
import platform from '@/platform'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { lastUsedModelStore } from './lastUsedModelStore'
import { queryClient } from './queryClient'
import { createInitialState, processStreamChunk } from './session/stream-chunk-processor'
import { buildToolsForSession } from './session/tools-builder'
import { settingsStore } from './settingsStore'
import { getTaskSession, TASK_SESSION_QUERY_KEY, updateTaskSession } from './taskSessionStore'
import { buildTaskSystemPrompt } from './taskSystemPrompt'
import { uiStore } from './uiStore'

const log = getLogger('task-session-actions')
const AGENT_STREAM_IDLE_TIMEOUT_MS = 180_000

// Note: Using a single module-level AbortController means only one task can generate at a time.
// This is intentional — prevents resource contention in the sandbox environment.
// If concurrent task generation is needed in the future, replace with a Map<taskId, AbortController>.
let currentAbortController: AbortController | null = null
let currentAgentRunId: string | null = null
const runCheckpointStore = new AgentRunCheckpointStore()
let recoveryRunning = false

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

export interface SubmitTaskMessageOptions {
  needGenerating?: boolean
  onUserMessageReady?: () => void
}

export async function submitTaskMessage(
  taskId: string,
  content: string | Message,
  options: SubmitTaskMessageOptions = {},
): Promise<void> {
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

  const userMessage: Message = typeof content === 'string' ? createMessage('user', content) : content
  const userMessageText = getMessageText(userMessage)

  const messagesWithUser = [...currentSession.messages, userMessage]
  const updated = await updateTaskSession(taskId, { messages: messagesWithUser })
  if (updated) {
    queryClient.setQueryData(queryKey, updated)
  } else {
    // Persist failed but update cache optimistically so UI stays consistent
    queryClient.setQueryData(queryKey, { ...currentSession, messages: messagesWithUser })
  }
  options.onUserMessageReady?.()

  if (options.needGenerating === false) {
    return
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
      const localOutcome = await tryRunLocalAndroidRecipe(taskId, userMessageText)
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

async function generateTaskResponse(
  taskId: string,
  targetMsg: Message,
  contextMessages: Message[],
  recovery?: AgentRunCheckpoint,
): Promise<void> {
  const queryKey = [TASK_SESSION_QUERY_KEY, taskId]
  const abortController = new AbortController()
  const deviceAgent = shouldUseDeviceAgent(platform.type, getAgentSessionConfig(taskId).deviceControlEnabled)
  // Scope persisted Broker checkpoints to one generated task message. A later
  // user request in the same session must be allowed to perform the same
  // legitimate action again, while retries of this message remain idempotent.
  const agentRunId = createAgentRunId(taskId, targetMsg.id)
  const loopGuard = new AgentLoopGuard()
  currentAbortController = abortController
  currentAgentRunId = agentRunId
  setActiveAgentRun(agentRunId)
  let featureRun: AgentRunLifecycleHandle | undefined
  let completedSuccessfully = false
  let sandboxEnabled = true
  let sandboxUnavailableReason = ''
  let detectedLoopStop: AgentLoopStoppedError | null = null
  let usageReservations = new Map<number, string>()
  let settlePendingUsage: (usage?: unknown, result?: unknown) => Promise<void> = async () => undefined
  let removeApprovalLifecycleListener: (() => void) | undefined
  let lastDraftPersistedAt = 0

  try {
    await runCheckpointStore.put({
      schemaVersion: 1,
      runId: agentRunId,
      taskId,
      assistantMessageId: targetMsg.id,
      phase: 'preparing',
      currentStep: recovery?.currentStep || 0,
      completedSteps: recovery?.completedSteps || [],
      updatedAt: Date.now(),
    })
    removeApprovalLifecycleListener = onAgentApprovalLifecycle((event) => {
      if (event.runId !== agentRunId) return
      if (event.state === 'requested') {
        void runCheckpointStore.update(agentRunId, {
          phase: 'awaiting_approval',
          pendingApproval: { title: event.title, risk: event.risk, kind: event.kind },
        })
      } else {
        void runCheckpointStore.update(agentRunId, { phase: 'requesting', pendingApproval: undefined })
      }
    })

    const session = queryClient.getQueryData<TaskSession>(queryKey)
    const { provider, modelId } = getDefaultModelSettings(session?.settings)
    const sessionSettings = {
      ...defaults.chatSessionSettings(),
      ...session?.settings,
      provider,
      modelId,
    }
    const dependencies = await createModelDependencies()
    const model = await createModel(sessionSettings, dependencies)
    const knownPrice = resolveDefaultAgentPrice(provider, modelId)
    // Usage powers diagnostics and context UI. Repetition is stopped by AgentLoopGuard,
    // while ordinary request and token counts never terminate a healthy run.
    const usageLedger = createAgentUsageLedger({ priceResolver: () => knownPrice })
    await usageLedger.recoverPendingReservations(Date.now(), agentRunId).catch((error) => {
      log.debug('usage ledger recovery skipped:', error)
    })
    usageReservations = new Map<number, string>()
    settlePendingUsage = async (usage?: unknown, result?: unknown) => {
      for (const [stepNumber, reservationId] of usageReservations) {
        await usageLedger
          .settle(reservationId, { usage: usage as Record<string, unknown> | undefined, result })
          .catch(() => undefined)
        usageReservations.delete(stepNumber)
      }
    }
    registerBuiltinFeatures()
    registerBuiltinFeatureLifecycles()
    const enabledFeatureIds = getEnabledFeatureIds()
    featureRun = await beginAgentRun(
      {
        agentRunId,
        taskId,
        abortSignal: abortController.signal,
        requestAbort: () => abortController.abort(),
        featureOptions: {
          'android-device': { enabled: deviceAgent },
          sandbox: { workingDirectory: session?.workingDirectory },
        },
      },
      enabledFeatureIds
    )
    const sandboxState = featureRun.getFeatureState<SandboxRunState>('sandbox')
    if (sandboxState) {
      sandboxEnabled = sandboxState.enabled
      sandboxUnavailableReason = sandboxState.unavailableReason
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
    const latestUserMessage = [...filteredContext].reverse().find((message) => message.role === 'user')
    const latestUserText = latestUserMessage ? getMessageText(latestUserMessage, true, true) : ''
    let relevantMemoryPrompt = ''
    if (latestUserText) {
      try {
        await rememberDurableUserStatements(latestUserText, {
          sessionId: taskId,
          messageId: latestUserMessage?.id,
        })
        relevantMemoryPrompt = await buildRelevantLongTermMemoryPrompt(latestUserText)
      } catch (error) {
        log.warn('Automatic memory update failed:', error)
      }
    }
    const systemMessage: Message = createMessage(
      'system',
      buildTaskSystemPrompt(workingDir, {
        agentIdentity: [buildAgentIdentityPrompt(), relevantMemoryPrompt].filter(Boolean).join('\n\n'),
        deviceAgent,
        enabledFeatureIds,
      }),
    )

    const promptMessages = [systemMessage, ...filteredContext]

    const skillSettings = settingsStore.getState().getSettings().skills
    const enabledSkillNames = enabledFeatureIds.has('skills') ? skillSettings.enabledSkillNames : []
    const inputSessionId = session?.linkedSessionId || taskId
    const uiState = uiStore.getState()
    const webBrowsing = uiState.sessionWebBrowsingMap[inputSessionId] ?? true
    const knowledgeBase = uiState.sessionKnowledgeBaseMap[inputSessionId]

    const { tools, instructions, activeTools } = await buildToolsForSession(model, {
      messages: promptMessages,
      agentSessionId: deviceAgent ? agentRunId : taskId,
      agentApprovalSessionId: deviceAgent ? taskId : undefined,
      featureOptions: {
        'web-search': { webBrowsing },
        'knowledge-base': { knowledgeBase },
        sandbox: { sandboxEnabled },
        workspace: { sandboxEnabled },
        coding: { projectId: session?.mode === 'coding' ? session.codingProjectId : undefined },
        skills: { enabledSkillNames, sandboxEnabled },
        'android-device': { deviceControlEnabled: deviceAgent },
        camera: { cameraSessionId: taskId },
        mcp: { agentSessionId: deviceAgent ? agentRunId : taskId },
      },
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
      providerOptions: resolveReasoningProviderOptions(sessionSettings),
      // A task session is always an Agent loop; phone control only changes which tools are exposed.
      agentMode: true,
      ...(activeTools ? { activeTools } : {}),
      agentLifecycle: {
        beforeRequest: async ({ stepNumber, messages, tools: toolDefinitions, activeTools: visibleTools }) => {
          await runCheckpointStore.update(agentRunId, { phase: 'requesting', currentStep: stepNumber })
          const strategyInstruction = loopGuard.takeStrategyInstruction()
          if (strategyInstruction) {
            messages.push({ role: 'user', content: `<loop_guard>${strategyInstruction}</loop_guard>` })
          }
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
              price: knownPrice,
            })
          usageReservations.set(stepNumber, reservation.reservationId)
        },
        onStepFinish: async ({ stepNumber, usage, result }) => {
          await runCheckpointStore.addStepResult(agentRunId, stepNumber, result)
          const reservationId = usageReservations.get(stepNumber)
          if (reservationId) {
            await usageLedger
              .settle(reservationId, {
                usage: usage as Record<string, unknown> | undefined,
                result,
              })
              .catch((error) => log.debug('usage ledger settlement skipped:', error))
            usageReservations.delete(stepNumber)
          }

          const warning = loopGuard.observeCompletedStep(result)
          if (!warning) return
          const decision = await requestAgentDecision({
            principal: CORE_AGENT_PRINCIPAL,
            sessionId: taskId,
            runId: agentRunId,
            signal: abortController.signal,
            title: '检测到 Agent 可能陷入循环',
            detail: warning.detail,
            risk: 'safe',
            kind: 'loop',
            alwaysAsk: true,
            rememberConversationApproval: false,
          })
          if (decision === 'deny') {
            detectedLoopStop = new AgentLoopStoppedError(warning)
            abortController.abort()
            throw detectedLoopStop
          }
          if (decision === 'conversation') loopGuard.changeStrategy()
          else loopGuard.continueOnce()
        },
        onFinish: async ({ usage, result }) => settlePendingUsage(usage, result),
        onAbort: async () => settlePendingUsage(),
        onError: async () => settlePendingUsage(),
      },
    }

    if (Object.keys(tools).length > 0) {
      chatOptions.tools = tools as ToolSet
    }

    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>

    let processorState = createInitialState()
    let lastOverlayUpdate = 0

    const streamCallbacks = {
      onFileReceived: (_mediaType: string, _base64: string) => Promise.resolve(''),
    }

    const iterator = stream[Symbol.asyncIterator]()
    while (true) {
      const next = await nextAgentStreamPart(
        iterator,
        AGENT_STREAM_IDLE_TIMEOUT_MS,
        () => abortController.abort(),
      )
      if (next.done) break
      const chunk = next.value
      const result = await processStreamChunk(chunk, processorState, streamCallbacks)
      processorState = result.state

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
      if (Date.now() - lastDraftPersistedAt >= 1_000) {
        lastDraftPersistedAt = Date.now()
        await persistTaskDraft(taskId, targetMsg)
        await runCheckpointStore.update(agentRunId, { phase: 'streaming' })
      }
      if (deviceAgent && isDeviceOperationOverlayVisible(agentRunId) && Date.now() - lastOverlayUpdate >= 120) {
        lastOverlayUpdate = Date.now()
        void updateDeviceOperationOverlay(agentRunId, getMessageText(targetMsg, true, true))
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
    await runCheckpointStore.finish(agentRunId, 'completed')
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.error('Task generation failed:', err)
    }
    const loopError = err instanceof AgentLoopStoppedError ? err : detectedLoopStop
    const error =
      loopError
        ? `Agent 已停止：${loopError.warning.detail}`
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
    await runCheckpointStore.finish(agentRunId, 'failed').catch(() => undefined)
  } finally {
    if (currentAbortController === abortController) currentAbortController = null
    if (currentAgentRunId === agentRunId) currentAgentRunId = null
    setActiveAgentRun(null)
    setActiveAgentSession(null)
    cancelPendingAgentApprovals(agentRunId)
    removeApprovalLifecycleListener?.()
    abortController.abort()
    const hadVisibleOverlay = isDeviceOperationOverlayVisible(agentRunId)
    await featureRun?.disposeAll().catch((cleanupError) => {
      log.debug('feature Agent-run cleanup failed:', cleanupError)
    })
    if (deviceAgent && hadVisibleOverlay) {
      if (completedSuccessfully && getAgentRuntimeSettings().returnToAppOnComplete) {
        await yachiyoDeviceAccessNative.bringAppToForeground().catch(() => undefined)
      }
    }
    await settlePendingUsage().catch(() => undefined)
  }
}

async function persistTaskDraft(taskId: string, targetMsg: Message): Promise<void> {
  const queryKey = [TASK_SESSION_QUERY_KEY, taskId]
  const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (!currentSession) return
  const draft = { ...targetMsg, cancel: undefined }
  const messages = currentSession.messages.map((message) => (message.id === draft.id ? draft : message))
  const persisted = await updateTaskSession(taskId, { messages })
  if (persisted) queryClient.setQueryData(queryKey, persisted)
}

/** Restarts interrupted model rounds with the same run id; Broker checkpoints prevent side-effect replay. */
export async function recoverInterruptedAgentRuns(): Promise<number> {
  if (recoveryRunning || currentAbortController) return 0
  recoveryRunning = true
  let recovered = 0
  try {
    const records = (await runCheckpointStore.listActive()).sort((left, right) => left.updatedAt - right.updatedAt)
    for (const record of records) {
      const session = await getTaskSession(record.taskId)
      if (!session) {
        await runCheckpointStore.finish(record.runId, 'failed')
        continue
      }
      const assistantIndex = session.messages.findIndex((message) => message.id === record.assistantMessageId)
      if (assistantIndex < 0) {
        await runCheckpointStore.finish(record.runId, 'failed')
        continue
      }
      const target = session.messages[assistantIndex]
      if (!target.generating) {
        await runCheckpointStore.finish(record.runId, target.error ? 'failed' : 'completed')
        continue
      }
      const resumableTarget = { ...target, generating: true, error: undefined }
      queryClient.setQueryData([TASK_SESSION_QUERY_KEY, record.taskId], session)
      await generateTaskResponse(record.taskId, resumableTarget, session.messages.slice(0, assistantIndex), record)
      recovered += 1
    }
    return recovered
  } finally {
    recoveryRunning = false
  }
}

function updateTaskQueryCache(queryKey: string[], targetMsg: Message): void {
  const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (currentSession) {
    const messages = currentSession.messages.map((m) => (m.id === targetMsg.id ? targetMsg : m))
    queryClient.setQueryData(queryKey, { ...currentSession, messages })
  }
}
