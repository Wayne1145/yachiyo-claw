import { ModelProviderEnum, type Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getState: vi.fn(),
  setSettings: vi.fn(),
  list: vi.fn(),
  getSession: vi.fn(),
  update: vi.fn(),
}))
vi.mock('./yachiyo-api', () => ({ fetchYachiyoModels: mocks.fetch }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: mocks.getState } }))
vi.mock('@/stores/chatStore', () => ({
  listAllSessionsMeta: mocks.list,
  getSession: mocks.getSession,
  updateSessionWithMessages: mocks.update,
}))

import { adoptDiscoveredYachiyoModel, refreshYachiyoModels } from './yachiyo-model-refresh'

function state() {
  return {
    providers: { yachiyo: { apiKey: 'saved-key', models: [{ modelId: 'retired' }] } },
    defaultChatModel: { provider: ModelProviderEnum.Yachiyo, model: 'retired' },
    setSettings: mocks.setSettings,
  }
}
function draft(): Session {
  return {
    id: 'draft',
    name: 'Untitled',
    type: 'chat',
    messages: [],
    settings: { provider: ModelProviderEnum.Yachiyo, modelId: 'retired' },
  }
}
describe('Yachiyo background model discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getState.mockReturnValue(state())
    mocks.list.mockResolvedValue([])
    mocks.fetch.mockResolvedValue([{ modelId: 'current', type: 'chat' }])
  })
  it('uses the live list even when the old fixed model is absent', async () => {
    await refreshYachiyoModels('saved-key')
    expect(mocks.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ defaultChatModel: { provider: 'yachiyo', model: 'current' } })
    )
  })
  it('leaves saved credentials untouched if model discovery fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'))
    await expect(refreshYachiyoModels('saved-key')).rejects.toThrow('offline')
    expect(mocks.setSettings).not.toHaveBeenCalled()
    expect(mocks.getState().providers.yachiyo.apiKey).toBe('saved-key')
  })
  it('ignores a stale result after changing keys or cancelling', async () => {
    await refreshYachiyoModels('old-key')
    await refreshYachiyoModels('saved-key', () => true)
    expect(mocks.setSettings).not.toHaveBeenCalled()
  })
  it('does not replace another providers default model', async () => {
    mocks.getState.mockReturnValue({ ...state(), defaultChatModel: { provider: 'openai', model: 'personal' } })
    await refreshYachiyoModels('saved-key')
    expect(mocks.setSettings.mock.calls[0][0]).not.toHaveProperty('defaultChatModel')
  })
  it('reports an empty list without deleting the saved key or inventing a fallback', async () => {
    mocks.fetch.mockResolvedValue([])
    await expect(refreshYachiyoModels('saved-key')).rejects.toThrow('yachiyo_chat_models_unavailable')
    expect(mocks.setSettings.mock.calls[0][0].defaultChatModel.model).toBe('')
  })
  it('repairs only unused drafts', async () => {
    const empty = draft()
    mocks.list.mockResolvedValue([{ id: empty.id }])
    mocks.getSession.mockResolvedValue(empty)
    await refreshYachiyoModels('saved-key')
    const update = mocks.update.mock.calls[0][1]
    expect(update(empty).settings.modelId).toBe('current')
    const started = { ...empty, messages: [{ id: 'u', role: 'user', contentParts: [], timestamp: 1 }] } as Session
    expect(update(started)).toBe(started)
  })
  it('preserves selected available models, other providers and existing context', () => {
    const ids = new Set(['current'])
    for (const session of [
      { ...draft(), settings: { provider: ModelProviderEnum.Yachiyo, modelId: 'current' } },
      { ...draft(), settings: { provider: ModelProviderEnum.OpenAI, modelId: 'personal' } },
      { ...draft(), messages: [{ id: 'a', role: 'assistant', contentParts: [], timestamp: 1 }] },
    ] as Session[])
      expect(adoptDiscoveredYachiyoModel(session, 'current', ids)).toBe(session)
  })
})
