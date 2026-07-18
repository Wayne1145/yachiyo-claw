import * as defaults from '@shared/defaults'
import type { ChatStreamOptions, ModelStreamPart } from '@shared/models/types'
import { createMessage, type Message, ModelProviderEnum, type TaskSession } from '@shared/types'
import { getMessageText, sequenceMessages } from '@shared/utils/message'
import type { ToolSet } from 'ai'
import { createModel, createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { buildAgentIdentityPrompt } from '@/mobile/agent-profile'
import { cancelPendingAgentApprovals, setActiveAgentSession } from '@/mobile/agent-approval'
import { getAgentRuntimeSettings } from '@/mobile/agent-runtime-settings'
import { nextAgentStreamPart } from '@/mobile/agent-stream-watchdog'
import { convertToModelMessages, injectModelSystemPrompt } from '@/packages/model-calls/message-utils'
import { onAndroidDeviceOperation } from '@/packages/model-calls/toolsets/android-device'
import platform from '@/platform'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
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
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  try {
    await platform.sandboxKill?.()
  } catch (err) {
    log.debug('sandbox kill during cancellation:', err)
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

  // Run compaction check before sending (same as chat mode)
  try {
    const { runTaskCompaction } = await import('./taskCompaction')
    await runTaskCompaction(taskId)
    // Re-fetch session after compaction (may have added messages/points)
    currentSession = queryClient.getQueryData<TaskSession>(queryKey) ?? currentSession
  } catch (err) {
    log.error('Task compaction failed:', err)
    // Don't block on compaction failure — proceed with send
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
  currentAbortController = abortController
  let overlayStopListener: Awaited<ReturnType<typeof yachiyoDeviceAccessNative.onOverlayStopRequested>> | undefined
  let overlayVisible = false
  let overlayStartPromise: Promise<void> | undefined
  let removeDeviceOperationListener: (() => void) | undefined
  let completedSuccessfully = false

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
    if (platform.type === 'mobile') {
      removeDeviceOperationListener = onAndroidDeviceOperation(async () => {
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
      const initResult = await platform.sandboxInit({ workingDirectory: session.workingDirectory })
      if (!initResult.success) {
        throw new Error(`Sandbox initialization failed: ${initResult.error || 'Unknown error'}`)
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
        agentIdentity: platform.type === 'mobile' ? buildAgentIdentityPrompt() : undefined,
        deviceAgent: platform.type === 'mobile',
      })
    )

    const promptMessages = [systemMessage, ...filteredContext]

    const skillSettings = settingsStore.getState().getSettings().skills
    const enabledSkillNames = featureFlags.skills ? skillSettings.enabledSkillNames : []

    const { tools, instructions } = await buildToolsForSession(model, {
      webBrowsing: true,
      messages: promptMessages,
      sandboxEnabled: true,
      enabledSkillNames,
      agentSessionId: taskId,
      cameraSessionId: taskId,
    })

    let injectedMessages = injectModelSystemPrompt(
      model.modelId,
      promptMessages,
      instructions,
      model.isSupportSystemMessage() ? 'system' : 'user'
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
    }

    if (Object.keys(tools).length > 0) {
      chatOptions.tools = tools as ToolSet
    }

    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>

    let processorState = createInitialState()
    let lastOverlayUpdate = 0

    const streamCallbacks = {
      onFileReceived: async (_mediaType: string, _base64: string) => {
        return ''
      },
    }

    const iterator = stream[Symbol.asyncIterator]()
    while (true) {
      const next = await nextAgentStreamPart(iterator, AGENT_STREAM_IDLE_TIMEOUT_MS, () => abortController.abort())
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
      if (platform.type === 'mobile' && overlayVisible && Date.now() - lastOverlayUpdate >= 120) {
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
    const error = abortController.signal.aborted ? undefined : err instanceof Error ? err.message : String(err)
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
    setActiveAgentSession(null)
    cancelPendingAgentApprovals(taskId)
    abortController.abort()
    try {
      removeDeviceOperationListener?.()
    } catch (cleanupError) {
      log.debug('device operation listener cleanup failed:', cleanupError)
    }
    await overlayStopListener?.remove().catch((cleanupError) => {
      log.debug('overlay stop listener cleanup failed:', cleanupError)
    })
    if (platform.type === 'mobile' && overlayVisible) {
      await yachiyoDeviceAccessNative.hideOperationOverlay().catch(() => undefined)
      if (completedSuccessfully && getAgentRuntimeSettings().returnToAppOnComplete) {
        await yachiyoDeviceAccessNative.bringAppToForeground().catch(() => undefined)
      }
    }
  }
}

function updateTaskQueryCache(queryKey: string[], targetMsg: Message): void {
  const currentSession = queryClient.getQueryData<TaskSession>(queryKey)
  if (currentSession) {
    const messages = currentSession.messages.map((m) => (m.id === targetMsg.id ? targetMsg : m))
    queryClient.setQueryData(queryKey, { ...currentSession, messages })
  }
}
