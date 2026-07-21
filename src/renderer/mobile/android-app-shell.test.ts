import { ModelProviderEnum, ModelProviderType, type Settings } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  createYachiyoApiSettingsPatch,
  hasConfiguredModelProvider,
  hasYachiyoDefaultModel,
  isAllowedAndroidShellPath,
  resolveAndroidShellBackAction,
  resolveAndroidShellTab,
  resolveAndroidShellWorkspaceView,
  shouldUseAndroidAppShell,
  YACHIYO_API_BASE_URL,
  YACHIYO_API_PROVIDER_ID,
  YACHIYO_DEFAULT_MODEL_ID,
} from './android-app-shell'

const emptySettings = (): Pick<Settings, 'customProviders' | 'defaultChatModel' | 'licenseKey' | 'providers'> => ({
  customProviders: [],
  defaultChatModel: undefined,
  licenseKey: '',
  providers: {},
})

describe('Android app shell state', () => {
  it('only enables the dedicated shell for Android mobile builds', () => {
    expect(shouldUseAndroidAppShell('mobile', 'android')).toBe(true)
    expect(shouldUseAndroidAppShell('mobile', 'ios')).toBe(false)
    expect(shouldUseAndroidAppShell('desktop', 'android')).toBe(false)
  })

  it('maps settings and Android agent task routes', () => {
    expect(resolveAndroidShellTab('/')).toBe('chat')
    expect(resolveAndroidShellTab('/session/123')).toBe('chat')
    expect(resolveAndroidShellTab('/settings/provider')).toBe('settings')
    expect(resolveAndroidShellTab('/about')).toBe('settings')
    expect(resolveAndroidShellTab('/tasks')).toBe('tasks')
    expect(resolveAndroidShellTab('/interactive')).toBe('interactive')
    expect(resolveAndroidShellTab('/', 'tasks')).toBe('tasks')
    expect(resolveAndroidShellTab('/settings', 'tasks')).toBe('tasks')
    expect(resolveAndroidShellTab('/task')).toBe('chat')
    expect(resolveAndroidShellTab('/task/agent-1')).toBe('chat')
    expect(isAllowedAndroidShellPath('/')).toBe(true)
    expect(isAllowedAndroidShellPath('/session/123')).toBe(true)
    expect(isAllowedAndroidShellPath('/settings/provider')).toBe(true)
    expect(isAllowedAndroidShellPath('/task')).toBe(true)
    expect(isAllowedAndroidShellPath('/task/agent-1')).toBe(true)
    expect(isAllowedAndroidShellPath('/tasks')).toBe(true)
    expect(isAllowedAndroidShellPath('/interactive')).toBe(true)
    expect(isAllowedAndroidShellPath('/copilots/featured')).toBe(false)
    expect(isAllowedAndroidShellPath('/image-creator')).toBe(false)
  })

  it('handles Android back gestures without consulting stale browser history', () => {
    expect(resolveAndroidShellBackAction('/settings/provider')).toBe('settings')
    expect(resolveAndroidShellBackAction('/about')).toBe('settings')
    expect(resolveAndroidShellBackAction('/settings')).toBe('chat')
    expect(resolveAndroidShellBackAction('/tasks')).toBe('chat')
    expect(resolveAndroidShellBackAction('/interactive')).toBe('chat')
    expect(resolveAndroidShellBackAction('/')).toBe('minimize')
    expect(resolveAndroidShellBackAction('/session/chat-1')).toBe('minimize')
    expect(resolveAndroidShellBackAction('/task/agent-1')).toBe('minimize')
  })

  it('renders an explicitly selected task workspace above settings routes', () => {
    expect(resolveAndroidShellWorkspaceView('/settings')).toBe('settings')
    expect(resolveAndroidShellWorkspaceView('/about')).toBe('about')
    expect(resolveAndroidShellWorkspaceView('/settings', 'tasks')).toBe('tasks')
    expect(resolveAndroidShellWorkspaceView('/settings/provider', 'tasks')).toBe('tasks')
    expect(resolveAndroidShellWorkspaceView('/about', 'tasks')).toBe('tasks')
  })

  it('recognizes usable remote credentials and keyless local providers', () => {
    expect(hasConfiguredModelProvider(emptySettings())).toBe(false)
    expect(
      hasConfiguredModelProvider({
        customProviders: [],
        licenseKey: '',
        providers: { openai: { apiKey: 'sk-test' } },
      })
    ).toBe(true)
    expect(
      hasConfiguredModelProvider({
        customProviders: [],
        licenseKey: '',
        providers: { ollama: { models: [{ modelId: 'local-model' }] } },
      })
    ).toBe(true)
    expect(
      hasConfiguredModelProvider({
        customProviders: [],
        licenseKey: '',
        providers: { [ModelProviderEnum.Local]: { models: [{ modelId: 'offline-model' }] } },
      })
    ).toBe(true)
    expect(
      hasConfiguredModelProvider({
        customProviders: [
          { id: 'custom-provider-empty', name: 'Empty', type: ModelProviderType.OpenAI, isCustom: true },
        ],
        licenseKey: '',
        providers: { 'custom-provider-empty': { apiKey: 'sk-test' } },
      })
    ).toBe(false)
  })

  it('requires the configured service to expose the product default model', () => {
    expect(hasYachiyoDefaultModel([{ modelId: 'gpt-5.6' }])).toBe(true)
    expect(hasYachiyoDefaultModel([{ modelId: 'gpt-5.6-mini' }])).toBe(false)
  })
})

describe('Yachiyo API onboarding configuration', () => {
  it('configures the built-in Chat Completions provider while preserving existing settings', () => {
    const settings = emptySettings()
    settings.providers = { openai: { apiKey: 'existing-key' } }

    const models = [{ modelId: YACHIYO_DEFAULT_MODEL_ID, type: 'chat' as const }]
    const patch = createYachiyoApiSettingsPatch(settings, '  sk-yachiyo-test  ', models)
    const yachiyo = patch.providers?.[YACHIYO_API_PROVIDER_ID]

    expect(patch.providers?.openai?.apiKey).toBe('existing-key')
    expect(patch.customProviders).toBeUndefined()
    expect(yachiyo).toMatchObject({
      apiKey: 'sk-yachiyo-test',
      apiHost: YACHIYO_API_BASE_URL,
      apiPath: '/chat/completions',
      models,
    })
    expect(yachiyo?.models?.[0]?.capabilities).toEqual(['vision', 'tool_use', 'reasoning'])
    expect(patch.defaultChatModel).toEqual({
      provider: ModelProviderEnum.Yachiyo,
      model: YACHIYO_DEFAULT_MODEL_ID,
    })
  })

  it('updates the built-in provider without dropping its existing settings', () => {
    const first = createYachiyoApiSettingsPatch(emptySettings(), 'first-key')
    const second = createYachiyoApiSettingsPatch(
      {
        customProviders: [],
        defaultChatModel: first.defaultChatModel,
        licenseKey: '',
        providers: {
          ...first.providers,
          [ModelProviderEnum.Yachiyo]: {
            ...first.providers?.[ModelProviderEnum.Yachiyo],
            useProxy: true,
          },
        },
      },
      'second-key'
    )

    expect(second.providers?.[YACHIYO_API_PROVIDER_ID]?.apiKey).toBe('second-key')
    expect(second.providers?.[YACHIYO_API_PROVIDER_ID]?.useProxy).toBe(true)
  })

  it('makes dynamically discovered Yachiyo models available to Agent mode', () => {
    const patch = createYachiyoApiSettingsPatch(emptySettings(), 'test-key', [
      { modelId: 'yachiyo-dynamic-model', type: 'chat' },
    ])

    expect(patch.providers?.[YACHIYO_API_PROVIDER_ID]?.models).toEqual([
      expect.objectContaining({
        modelId: 'yachiyo-dynamic-model',
        capabilities: ['tool_use'],
      }),
    ])
  })

  it('rejects an empty key without mutating settings', () => {
    expect(() => createYachiyoApiSettingsPatch(emptySettings(), '   ')).toThrow('api_key_required')
  })
})
