import type { SessionSettings } from '@shared/types'
import { updateSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { queryClient } from '@/stores/queryClient'
import { TASK_SESSION_QUERY_KEY, updateTaskSession } from '@/stores/taskSessionStore'

export type InteractiveConversationMode = 'chat' | 'agent'

export interface InteractiveModelSelection {
  provider: string
  modelId: string
}

function modelFromSettings(settings?: SessionSettings): InteractiveModelSelection | undefined {
  if (!settings?.provider || !settings.modelId) return undefined
  return { provider: settings.provider, modelId: settings.modelId }
}

export function resolveInteractiveModelSelection({
  mode,
  chatSettings,
  taskSettings,
  lastUsedChat,
  lastUsedTask,
  defaultChat,
}: {
  mode: InteractiveConversationMode
  chatSettings?: SessionSettings
  taskSettings?: SessionSettings
  lastUsedChat?: InteractiveModelSelection
  lastUsedTask?: InteractiveModelSelection
  defaultChat?: InteractiveModelSelection
}): InteractiveModelSelection | undefined {
  const candidates =
    mode === 'agent'
      ? [modelFromSettings(taskSettings), modelFromSettings(chatSettings), lastUsedTask, defaultChat, lastUsedChat]
      : [modelFromSettings(chatSettings), lastUsedChat, defaultChat]
  return candidates.find((candidate): candidate is InteractiveModelSelection =>
    Boolean(candidate?.provider && candidate.modelId)
  )
}

export async function updateInteractiveModelSelection({
  mode,
  sessionId,
  taskId,
  chatSettings,
  taskSettings,
  provider,
  modelId,
}: {
  mode: InteractiveConversationMode
  sessionId?: string
  taskId?: string
  chatSettings?: SessionSettings
  taskSettings?: SessionSettings
  provider: string
  modelId: string
}): Promise<void> {
  if (mode === 'agent') {
    if (!taskId) throw new Error('interactive_agent_task_not_ready')
    const updated = await updateTaskSession(taskId, {
      settings: { ...(taskSettings || chatSettings || {}), provider, modelId },
    })
    if (!updated) throw new Error('interactive_model_settings_save_failed')
    queryClient.setQueryData([TASK_SESSION_QUERY_KEY, taskId], updated)
    lastUsedModelStore.getState().setTaskModel(provider, modelId)
    return
  }

  if (!sessionId) throw new Error('interactive_chat_session_not_ready')
  await updateSession(sessionId, {
    settings: { ...(chatSettings || {}), provider, modelId },
  })
  lastUsedModelStore.getState().setChatModel(provider, modelId)
}
