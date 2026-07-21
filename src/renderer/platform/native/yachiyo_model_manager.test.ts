import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNativeModelDownloadSink,
  NativeLocalInferenceAdapter,
  NativeMobileRagEmbeddingProvider,
} from './yachiyo_model_manager'

const native = vi.hoisted(() => ({
  enqueue: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  healthCheck: vi.fn(),
  infer: vi.fn(),
  embed: vi.fn(),
  list: vi.fn(),
  addListener: vi.fn(),
  unload: vi.fn(),
  deleteModel: vi.fn(),
  deviceProfile: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))

describe('YachiyoModelManager bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the validated download plan to the native worker', async () => {
    native.enqueue.mockResolvedValue({ accepted: true, jobId: 'job-1' })
    const sink = createNativeModelDownloadSink()
    const job = { id: 'job-1', modelId: 'org/model' } as never
    await sink.enqueue(job)
    expect(native.enqueue).toHaveBeenCalledWith({ job })
  })

  it('keeps local inference events behind the shared adapter boundary', async () => {
    native.healthCheck.mockResolvedValue({ status: 'supported' })
    native.infer.mockResolvedValue({ events: [{ type: 'text', text: 'hello' }] })
    const adapter = new NativeLocalInferenceAdapter()
    expect(await adapter.isAvailable('model-1')).toBe(true)
    await expect(adapter.stream('model-1', { messages: [] }).next()).resolves.toMatchObject({
      value: { type: 'text', text: 'hello' },
    })
  })

  it('uses an explicitly configured installed local embedding model', async () => {
    native.embed.mockResolvedValue({ modelId: 'embedder', embeddings: [[0, 1]] })
    const provider = new NativeMobileRagEmbeddingProvider()

    await expect(provider.embed({ model: 'yachiyo-local:embedder', texts: ['hello'] })).resolves.toEqual([[0, 1]])
    expect(native.embed).toHaveBeenCalledWith({ modelId: 'embedder', texts: ['hello'] })
  })

  it('selects the first completed TFLite model for attachment RAG', async () => {
    native.list.mockResolvedValue({
      jobs: [
        { modelId: 'chat', status: 'completed', artifacts: [{ format: 'litertlm' }] },
        { modelId: 'embedding', status: 'completed', artifacts: [{ format: 'tflite' }] },
      ],
    })
    native.embed.mockResolvedValue({ modelId: 'embedding', embeddings: [[1, 0]] })
    const provider = new NativeMobileRagEmbeddingProvider()

    await expect(provider.embed({ texts: ['query'] })).resolves.toEqual([[1, 0]])
    expect(native.embed).toHaveBeenCalledWith({ modelId: 'embedding', texts: ['query'] })
  })
})
