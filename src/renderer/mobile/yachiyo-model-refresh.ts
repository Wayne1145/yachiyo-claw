import { selectYachiyoChatModelId } from '@shared/providers/definitions/yachiyo-models'
import { ModelProviderEnum, type Session } from '@shared/types'
import { getSession, listAllSessionsMeta, updateSessionWithMessages } from '@/stores/chatStore'
import { settingsStore } from '@/stores/settingsStore'
import { createYachiyoApiSettingsPatch } from './android-app-shell'
import { fetchYachiyoModels } from './yachiyo-api'

export function adoptDiscoveredYachiyoModel(session: Session, modelId: string, availableIds: Set<string>): Session {
  if (
    !modelId ||
    session.type !== 'chat' ||
    session.messages.some((message) => message.role !== 'system') ||
    session.threads?.length ||
    (session.settings?.provider && session.settings.provider !== ModelProviderEnum.Yachiyo) ||
    availableIds.has(session.settings?.modelId || '')
  )
    return session
  // Only repair unused drafts, never silently switch a real conversation's model or context.
  return { ...session, settings: { ...session.settings, provider: ModelProviderEnum.Yachiyo, modelId } }
}

export async function refreshYachiyoModels(apiKey: string, cancelled = () => false): Promise<void> {
  const models = await fetchYachiyoModels(apiKey)
  const current = settingsStore.getState()
  if (cancelled() || current.providers?.[ModelProviderEnum.Yachiyo]?.apiKey?.trim() !== apiKey) return
  const patch = createYachiyoApiSettingsPatch(current, apiKey, models)
  // Refreshing a secondary provider must not steal the user's global default.
  if (current.defaultChatModel && current.defaultChatModel.provider !== ModelProviderEnum.Yachiyo) {
    delete patch.defaultChatModel
  }
  // Metadata uses normal encrypted persistence; do not re-commit credentials asynchronously.
  current.setSettings(patch)
  const modelId = selectYachiyoChatModelId(models, patch.defaultChatModel?.model)
  if (cancelled()) return
  if (!modelId) throw new Error('yachiyo_chat_models_unavailable')
  const available = new Set(models.map((model) => model.modelId))
  for (const record of await listAllSessionsMeta()) {
    if (cancelled()) return
    const draft = await getSession(record.id)
    if (!draft || adoptDiscoveredYachiyoModel(draft, modelId, available) === draft) continue
    await updateSessionWithMessages(record.id, (session) => {
      if (!session) throw new Error('chat_session_not_found')
      return adoptDiscoveredYachiyoModel(session, modelId, available)
    })
  }
}
