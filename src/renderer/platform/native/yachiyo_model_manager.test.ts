import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNativeModelDownloadSink,
  NativeLocalInferenceAdapter,
  NativeMobileRagEmbeddingProvider,
  serializeLocalModelMessages,
  serializeLocalTools,
} from './yachiyo_model_manager'
import { tool } from 'ai'
import { z } from 'zod'

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

  it('keeps the native health reason so callers can distinguish missing registrations and files', async () => {
    native.healthCheck.mockResolvedValue({ status: 'unsupported', reason: 'local_model_file_missing' })
    const adapter = new NativeLocalInferenceAdapter()

    await expect(adapter.checkAvailability('model-1')).resolves.toEqual({
      available: false,
      reason: 'local_model_file_missing',
    })
  })

  it('serializes tool descriptions and JSON schemas without executable functions', async () => {
    const execute = vi.fn()
    const serialized = await serializeLocalTools({
      inspect: tool({
        description: 'Inspect a project file',
        inputSchema: z.object({ path: z.string() }),
        execute,
      }),
    })

    expect(serialized).toMatchObject({
      inspect: {
        description: 'Inspect a project file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    })
    expect(JSON.stringify(serialized)).not.toContain('execute')
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

  it('preserves broker tool calls and results for the next native inference step', () => {
    expect(
      serializeLocalModelMessages([
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'device_info', input: {} }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'device_info',
              output: { model: 'SM-S9280' },
            },
          ],
        },
      ]),
    ).toEqual([
      { role: 'assistant', content: [{ type: 'tool-call', name: 'device_info', arguments: {} }] },
      {
        role: 'tool',
        content: [{ type: 'tool-response', name: 'device_info', response: { model: 'SM-S9280' } }],
      },
    ])
  })
})
