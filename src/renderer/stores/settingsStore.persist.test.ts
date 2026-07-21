import { beforeEach, describe, expect, it, vi } from 'vitest'

type PersistedSettings = Record<string, unknown> | null

async function loadSettingsStoreModule(persistedSettings: PersistedSettings = null) {
  vi.resetModules()

  const mockStorage = {
    getItem: vi.fn((key: string, initialValue: unknown) => {
      if (key === 'settings') {
        return persistedSettings
      }
      return initialValue
    }),
    setItem: vi.fn(async () => undefined),
    setItemNow: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  }

  vi.doMock('@/platform', () => ({
    default: {
      type: 'desktop',
      ensureShortcutConfig: vi.fn(),
      ensureProxyConfig: vi.fn(),
      ensureAutoLaunch: vi.fn(),
      appLog: vi.fn(async () => undefined),
    },
  }))

  vi.doMock('@/storage', () => ({
    default: mockStorage,
    StorageKey: { Settings: 'settings' },
  }))

  const settingsStoreModule = await import('./settingsStore')
  const providerSettingsModule = await import('./providerSettings')

  return {
    ...settingsStoreModule,
    ...providerSettingsModule,
    mockStorage,
  }
}

async function waitForPersistCall(assertion: () => void, attempts = 10) {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  throw lastError
}

describe('settingsStore persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unmock('@/platform')
    vi.unmock('@/storage')
  })

  it('rehydrates persisted provider and custom provider settings', async () => {
    const persistedSettings = {
      providers: {
        openai: {
          apiKey: 'sk-openai',
          models: [{ modelId: 'gpt-5' }],
        },
      },
      customProviders: [
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          type: 'openai',
          isCustom: true,
        },
      ],
      __version: 4,
    }

    const { initSettingsStore, settingsStore } = await loadSettingsStoreModule(persistedSettings)

    const hydrated = await initSettingsStore()

    expect(hydrated.providers?.openai?.apiKey).toBe('sk-openai')
    expect(hydrated.providers?.openai?.models).toEqual([{ modelId: 'gpt-5' }])
    expect(hydrated.customProviders).toEqual([
      {
        id: 'custom-openai',
        name: 'Custom OpenAI',
        type: 'openai',
        isCustom: true,
      },
    ])
    expect(settingsStore.getState().providers?.openai?.apiKey).toBe('sk-openai')
  })

  it('persists merged provider settings without dropping sibling providers', async () => {
    const persistedSettings = {
      providers: {
        claude: {
          apiKey: 'sk-claude',
        },
      },
      __version: 8,
    }

    const { initSettingsStore, settingsStore, mergeProviderSettings, mockStorage } =
      await loadSettingsStoreModule(persistedSettings)

    await initSettingsStore()

    settingsStore.setState((currentSettings) =>
      mergeProviderSettings(currentSettings, 'openai', {
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com',
      })
    )

    await waitForPersistCall(() => {
      expect(mockStorage.setItem).toHaveBeenCalled()
    })

    const lastPersistCall = mockStorage.setItem.mock.calls.at(-1)
    expect(lastPersistCall).toBeDefined()
    if (!lastPersistCall) {
      throw new Error('Expected settings persistence call to exist')
    }

    const [storageKey, persistedValue] = lastPersistCall as unknown as [string, Record<string, unknown>]

    expect(storageKey).toBe('settings')
    expect(persistedValue).toMatchObject({
      providers: {
        claude: {
          apiKey: 'sk-claude',
        },
        openai: {
          apiKey: 'sk-openai',
          apiHost: 'https://api.openai.com',
        },
      },
        __version: 8,
    })
  })

  it('upgrades stored Yachiyo GPT capabilities without changing non-chat models', async () => {
    const persistedSettings = {
      providers: {
        yachiyo: {
          apiKey: 'sk-yachiyo',
          models: [
            { modelId: 'gpt-5.6-mini', type: 'chat', capabilities: ['web_search'] },
            { modelId: 'gpt-image-1', type: 'image' },
            { modelId: 'text-embedding-3-large', type: 'embedding' },
          ],
        },
      },
      __version: 7,
    }

    const { initSettingsStore } = await loadSettingsStoreModule(persistedSettings)
    const hydrated = await initSettingsStore()

    expect(hydrated.providers?.yachiyo?.models).toEqual([
      expect.objectContaining({
        modelId: 'gpt-5.6-mini',
        type: 'chat',
        capabilities: ['web_search', 'vision', 'tool_use', 'reasoning'],
      }),
      expect.objectContaining({ modelId: 'gpt-image-1', type: 'image' }),
      expect.objectContaining({ modelId: 'text-embedding-3-large', type: 'embedding' }),
    ])
    expect(hydrated.providers?.yachiyo?.models?.[1]?.capabilities).toBeUndefined()
    expect(hydrated.providers?.yachiyo?.models?.[2]?.capabilities).toBeUndefined()
  })

  it('waits for a direct credential write before publishing settings in memory', async () => {
    const { persistSettingsPatch, settingsStore, mockStorage } = await loadSettingsStoreModule()

    await persistSettingsPatch({ providers: { yachiyo: { apiKey: 'disposable-key' } } })

    expect(mockStorage.setItemNow).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        providers: { yachiyo: { apiKey: 'disposable-key' } },
        __version: 8,
      })
    )
    expect(settingsStore.getState().providers?.yachiyo?.apiKey).toBe('disposable-key')
  })

  it('does not publish credential settings when the direct write fails', async () => {
    const { persistSettingsPatch, settingsStore, mockStorage } = await loadSettingsStoreModule()
    mockStorage.setItemNow.mockRejectedValueOnce(new Error('secure storage unavailable'))

    await expect(persistSettingsPatch({ providers: { yachiyo: { apiKey: 'disposable-key' } } })).rejects.toThrow(
      'secure storage unavailable'
    )
    expect(settingsStore.getState().providers?.yachiyo).toBeUndefined()
  })
})
