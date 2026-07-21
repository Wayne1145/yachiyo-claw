import { describe, expect, it, vi } from 'vitest'
import type { ModelCatalogController, ModelCatalogSource, RemoteModel } from '@shared/models/model-catalog'
import { searchMobileModelCatalog } from './model-catalog-controller'

function model(id: string, source: ModelCatalogSource): RemoteModel {
  return { id, source } as RemoteModel
}

describe('searchMobileModelCatalog', () => {
  it('keeps a healthy platform result when the other platform fails', async () => {
    const controller = {
      search: vi.fn((source: ModelCatalogSource) =>
        source === 'huggingface'
          ? Promise.resolve([model('owner/model', source)])
          : Promise.reject(new Error('modelscope unavailable')),
      ),
    } as unknown as ModelCatalogController

    const result = await searchMobileModelCatalog(
      controller,
      ['huggingface', 'modelscope'],
      { query: 'model' },
      { timeoutMs: { huggingface: 100, modelscope: 100 } },
    )

    expect(result.models.map((item) => item.id)).toEqual(['owner/model'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].source).toBe('modelscope')
  })

  it('times out one platform even when its fetch ignores AbortSignal', async () => {
    const controller = {
      search: vi.fn((source: ModelCatalogSource) =>
        source === 'huggingface'
          ? Promise.resolve([model('owner/model', source)])
          : new Promise<RemoteModel[]>(() => undefined),
      ),
    } as unknown as ModelCatalogController

    const result = await searchMobileModelCatalog(
      controller,
      ['huggingface', 'modelscope'],
      { query: 'model' },
      { timeoutMs: { huggingface: 100, modelscope: 5 } },
    )

    expect(result.models).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ source: 'modelscope' })
    expect((result.failures[0].error as Error).message).toBe('model_catalog_modelscope_timeout')
  })

  it('cancels every platform from the caller signal', async () => {
    const receivedSignals: AbortSignal[] = []
    const controller = {
      search: vi.fn((_source: ModelCatalogSource, options: { signal?: AbortSignal }) => {
        receivedSignals.push(options.signal!)
        return new Promise<RemoteModel[]>(() => undefined)
      }),
    } as unknown as ModelCatalogController
    const abort = new AbortController()
    const pending = searchMobileModelCatalog(
      controller,
      ['huggingface', 'modelscope'],
      { query: 'model' },
      { signal: abort.signal, timeoutMs: { huggingface: 1_000, modelscope: 1_000 } },
    )

    abort.abort()
    const result = await pending

    expect(receivedSignals).toHaveLength(2)
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(result.failures).toHaveLength(2)
  })
})
