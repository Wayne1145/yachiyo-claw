import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNativeModelDownloadSink,
  NativeLocalInferenceAdapter,
  NativeMobileRagEmbeddingProvider,
  serializeLocalModelMessages,
} from './yachiyo_model_manager'

const native = vi.hoisted(() => ({
  enqueue: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  healthCheck: vi.fn(),
  modelCapabilities: vi.fn(),
  infer: vi.fn(),
  cancelInference: vi.fn(),
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
    expect(native.infer).toHaveBeenCalledWith(expect.objectContaining({ messages: [] }))
  })

  it('forwards cancellation to the native inference request', async () => {
    native.healthCheck.mockResolvedValue({ status: 'supported' })
    native.infer.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ events: [] }), 10)))
    native.cancelInference.mockResolvedValue({ cancelled: true })
    const adapter = new NativeLocalInferenceAdapter()
    const controller = new AbortController()
    const stream = adapter.stream('model-1', { messages: [], signal: controller.signal })
    const pending = stream.next()
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.cancelInference).toHaveBeenCalledWith({ requestId: expect.stringMatching(/^local-/) })
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

  it('serializes base64 image/audio content for native runtimes', () => {
    expect(
      serializeLocalModelMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image', image: 'aW1hZ2U=', mediaType: 'image/png' },
            { type: 'file', data: 'data:audio/wav;base64,YXVkaW8=', mediaType: 'audio/wav' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this' },
          { type: 'image', data: 'aW1hZ2U=', mediaType: 'image/png' },
          { type: 'audio', data: 'YXVkaW8=', mediaType: 'audio/wav' },
        ],
      },
    ])
  })

  it('does not pass remote media URLs to a local runtime', () => {
    expect(
      serializeLocalModelMessages([{ role: 'user', content: [{ type: 'image', image: 'https://example.com/a.png' }] }]),
    ).toEqual([{ role: 'user', content: [] }])
  })
})
