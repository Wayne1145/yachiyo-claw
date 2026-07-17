import { ApiError, NetworkError } from '@shared/models/errors'
import type { ModelDependencies } from '@shared/types/adapters'
import { describe, expect, it, vi } from 'vitest'
import { fetchYachiyoModels } from './yachiyo-api'

function createDependencies(apiRequest: ModelDependencies['request']['apiRequest']): ModelDependencies {
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

describe('fetchYachiyoModels', () => {
  it('requests the authenticated OpenAI-compatible model list', async () => {
    const apiRequest = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-5.6', object: 'model', created: 1 },
            { id: 'gpt-5.6-mini', object: 'model', created: 1 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const models = await fetchYachiyoModels('  disposable-key  ', createDependencies(apiRequest))

    expect(models.map((model) => model.modelId)).toEqual(['gpt-5.6', 'gpt-5.6-mini'])
    expect(apiRequest).toHaveBeenCalledWith({
      url: 'https://api.yachiyo8000.cn/v1/models',
      method: 'GET',
      headers: { Authorization: 'Bearer disposable-key' },
      useProxy: undefined,
    })
  })

  it('rejects an empty key before issuing a request', async () => {
    const apiRequest = vi.fn()
    await expect(fetchYachiyoModels('  ', createDependencies(apiRequest))).rejects.toThrow('api_key_required')
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('preserves a 401 response so onboarding can identify an invalid key', async () => {
    const apiRequest = vi.fn().mockRejectedValue(new ApiError('Unauthorized', undefined, 401))

    await expect(fetchYachiyoModels('invalid-key', createDependencies(apiRequest))).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('preserves network failures without exposing the key', async () => {
    const apiRequest = vi.fn().mockRejectedValue(new NetworkError('offline', 'https://api.yachiyo8000.cn'))

    await expect(fetchYachiyoModels('private-network-key', createDependencies(apiRequest))).rejects.toBeInstanceOf(
      NetworkError
    )
  })
})
