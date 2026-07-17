import { describe, expect, it, vi } from 'vitest'
import { chatSessionSettings } from '../../defaults'
import { ModelProviderEnum, ModelProviderType } from '../../types'
import type { ModelDependencies } from '../../types/adapters'
import Claude from './models/claude'
import OpenAI from './models/openai'
import OpenAIResponses from './models/openai-responses'
import { YACHIYO_API_HOST, YACHIYO_DEFAULT_MODEL, yachiyoProvider } from './yachiyo'

function createDependencies(apiRequest = vi.fn()): ModelDependencies {
  return {
    request: {
      apiRequest,
      fetchWithOptions: vi.fn(),
    },
    storage: {
      getImage: vi.fn(),
      saveImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn(),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'mobile',
  }
}

function createYachiyoModel(
  dependencies: ModelDependencies,
  apiKey = 'test-key',
  formattedApiHost = YACHIYO_API_HOST,
  apiStyle: 'openai' | 'openai-responses' | 'anthropic' = 'openai'
) {
  return yachiyoProvider.createModel({
    settings: chatSessionSettings(),
    globalSettings: {} as never,
    config: { uuid: 'test' },
    dependencies,
    providerSetting: {},
    formattedApiHost,
    formattedApiPath: '/chat/completions',
    model: { modelId: YACHIYO_DEFAULT_MODEL, apiStyle },
    effectiveApiKey: apiKey,
  })
}

describe('Yachiyo provider', () => {
  it('uses the built-in Chat Completions endpoint and gpt-5.6 default', () => {
    expect(yachiyoProvider.id).toBe(ModelProviderEnum.Yachiyo)
    expect(yachiyoProvider.type).toBe(ModelProviderType.OpenAI)
    expect(yachiyoProvider.defaultSettings).toMatchObject({
      apiHost: YACHIYO_API_HOST,
      apiPath: '/chat/completions',
      models: [{ modelId: YACHIYO_DEFAULT_MODEL, apiStyle: 'openai' }],
    })
    expect(chatSessionSettings()).toMatchObject({
      provider: ModelProviderEnum.Yachiyo,
      modelId: YACHIYO_DEFAULT_MODEL,
    })
  })

  it('supports Responses and Anthropic transports for each configured model', () => {
    const responses = createYachiyoModel(createDependencies(), 'test-key', YACHIYO_API_HOST, 'openai-responses')
    const anthropic = createYachiyoModel(createDependencies(), 'test-key', YACHIYO_API_HOST, 'anthropic')

    expect(responses).toBeInstanceOf(OpenAIResponses)
    expect((responses as OpenAIResponses).options).toMatchObject({
      apiHost: YACHIYO_API_HOST,
      apiPath: '/responses',
    })
    expect(anthropic).toBeInstanceOf(Claude)
    expect((anthropic as Claude).options.claudeApiHost).toBe(YACHIYO_API_HOST)
  })

  it('creates the shared OpenAI Chat Completions transport', () => {
    const model = createYachiyoModel(createDependencies())

    expect(model).toBeInstanceOf(OpenAI)
    expect((model as OpenAI).options).toMatchObject({
      apiKey: 'test-key',
      apiHost: YACHIYO_API_HOST,
      model: { modelId: YACHIYO_DEFAULT_MODEL },
    })
  })

  it('ignores a stored host override for the product service', () => {
    const model = createYachiyoModel(createDependencies(), 'test-key', 'https://untrusted.example/v1')

    expect((model as OpenAI).options.apiHost).toBe(YACHIYO_API_HOST)
  })

  it('lists models from the authenticated v1 endpoint', async () => {
    const apiRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: YACHIYO_DEFAULT_MODEL, object: 'model', created: 0 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const model = createYachiyoModel(createDependencies(apiRequest), 'secret-test-key')

    await expect((model as OpenAI).listModels()).resolves.toEqual([{ modelId: YACHIYO_DEFAULT_MODEL, type: 'chat' }])
    expect(apiRequest).toHaveBeenCalledWith({
      url: `${YACHIYO_API_HOST}/models`,
      method: 'GET',
      headers: { Authorization: 'Bearer secret-test-key' },
      useProxy: false,
    })
  })
})
