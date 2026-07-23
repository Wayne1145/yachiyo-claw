import type { SessionSettings } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
  updateTaskSession: vi.fn(),
  setQueryData: vi.fn(),
  setChatModel: vi.fn(),
  setTaskModel: vi.fn(),
}))

vi.mock('@/stores/chatStore', () => ({ updateSession: mocks.updateSession }))
vi.mock('@/stores/queryClient', () => ({ queryClient: { setQueryData: mocks.setQueryData } }))
vi.mock('@/stores/taskSessionStore', () => ({
  TASK_SESSION_QUERY_KEY: 'task-session',
  updateTaskSession: mocks.updateTaskSession,
}))
vi.mock('@/stores/lastUsedModelStore', () => ({
  lastUsedModelStore: {
    getState: () => ({ setChatModel: mocks.setChatModel, setTaskModel: mocks.setTaskModel }),
  },
}))

import { resolveInteractiveModelSelection, updateInteractiveModelSelection } from './interactive-model-selection'

describe('interactive model selection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses task settings in Agent mode and chat settings in chat mode', () => {
    const chatSettings = { provider: 'chat-provider', modelId: 'chat-model' } as SessionSettings
    const taskSettings = { provider: 'task-provider', modelId: 'task-model' } as SessionSettings

    expect(resolveInteractiveModelSelection({ mode: 'chat', chatSettings, taskSettings })).toEqual({
      provider: 'chat-provider',
      modelId: 'chat-model',
    })
    expect(resolveInteractiveModelSelection({ mode: 'agent', chatSettings, taskSettings })).toEqual({
      provider: 'task-provider',
      modelId: 'task-model',
    })
  })

  it('updates only chat settings without changing messages', async () => {
    const settings = { provider: 'old', modelId: 'old-model', temperature: 0.3 } as SessionSettings

    await updateInteractiveModelSelection({
      mode: 'chat',
      sessionId: 'chat-1',
      chatSettings: settings,
      provider: 'next',
      modelId: 'next-model',
    })

    expect(mocks.updateSession).toHaveBeenCalledWith('chat-1', {
      settings: { ...settings, provider: 'next', modelId: 'next-model' },
    })
    expect(mocks.setChatModel).toHaveBeenCalledWith('next', 'next-model')
    expect(mocks.updateTaskSession).not.toHaveBeenCalled()
  })

  it('updates the Agent task and refreshes its query cache', async () => {
    const updated = { id: 'task-1', settings: { provider: 'next', modelId: 'next-model' } }
    mocks.updateTaskSession.mockResolvedValue(updated)

    await updateInteractiveModelSelection({
      mode: 'agent',
      taskId: 'task-1',
      taskSettings: { temperature: 0.2 } as SessionSettings,
      provider: 'next',
      modelId: 'next-model',
    })

    expect(mocks.updateTaskSession).toHaveBeenCalledWith('task-1', {
      settings: { temperature: 0.2, provider: 'next', modelId: 'next-model' },
    })
    expect(mocks.setQueryData).toHaveBeenCalledWith(['task-session', 'task-1'], updated)
    expect(mocks.setTaskModel).toHaveBeenCalledWith('next', 'next-model')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('does not report an Agent model as selected when persistence fails', async () => {
    mocks.updateTaskSession.mockResolvedValue(undefined)

    await expect(
      updateInteractiveModelSelection({
        mode: 'agent',
        taskId: 'task-1',
        provider: 'next',
        modelId: 'next-model',
      }),
    ).rejects.toThrow('interactive_model_settings_save_failed')

    expect(mocks.setTaskModel).not.toHaveBeenCalled()
    expect(mocks.setQueryData).not.toHaveBeenCalled()
  })
})
