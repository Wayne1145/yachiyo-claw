import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNativeModelDownloadSink, NativeLocalInferenceAdapter } from './yachiyo_model_manager'

const native = vi.hoisted(() => ({
  enqueue: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  healthCheck: vi.fn(),
  infer: vi.fn(),
  addListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))

describe('YachiyoModelManager bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes only job/model identifiers to native download controls', async () => {
    native.enqueue.mockResolvedValue({ accepted: true, jobId: 'job-1' })
    const sink = createNativeModelDownloadSink()
    await sink.enqueue({ id: 'job-1', modelId: 'org/model' } as never)
    expect(native.enqueue).toHaveBeenCalledWith({ jobId: 'job-1', modelId: 'org/model' })
  })

  it('keeps local inference events behind the shared adapter boundary', async () => {
    native.healthCheck.mockResolvedValue({ status: 'supported' })
    native.infer.mockResolvedValue({ events: [{ type: 'text', text: 'hello' }] })
    const adapter = new NativeLocalInferenceAdapter()
    expect(await adapter.isAvailable('model-1')).toBe(true)
    await expect(adapter.stream('model-1', { messages: [] }).next()).resolves.toMatchObject({ value: { type: 'text', text: 'hello' } })
  })
})
