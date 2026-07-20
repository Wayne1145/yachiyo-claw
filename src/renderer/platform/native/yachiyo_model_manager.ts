import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import type { DownloadJob, ModelRuntime } from '@shared/models/model-catalog'
import type { LocalInferenceAdapter } from '@shared/types/adapters'

export interface NativeModelManagerCapabilities {
  schemaVersion: 1
  runtimes: Array<ModelRuntime | string>
  maxConcurrentFiles: number
  maxConcurrentSegments: number
  appPrivateStorage: boolean
  workManager: boolean
  localInference: boolean
}

export interface NativeModelProgressEvent {
  jobId: string
  modelId: string
  status: DownloadJob['status'] | 'unknown'
  bytesDownloaded: number
  bytesTotal: number
  errorCode?: string
}

interface NativeModelManagerPlugin {
  list(): Promise<{ schemaVersion: 1; jobs: DownloadJob[] }>
  enqueue(options: { jobId: string; modelId: string }): Promise<{ accepted: boolean; jobId: string }>
  pause(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  resume(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  cancel(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  reconcile(): Promise<{ schemaVersion: 1; recovered: number }>
  capabilities(): Promise<NativeModelManagerCapabilities>
  healthCheck(options: { modelId: string }): Promise<{ status: 'supported' | 'warning' | 'unsupported' | 'unknown'; reason?: string }>
  infer(options: { modelId: string; messages: unknown[]; tools?: unknown }): Promise<{
    events: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; name: string; arguments: unknown; callId: string }
      | { type: 'status'; status: string }
    >
  }>
  addListener(eventName: 'progress', listener: (event: NativeModelProgressEvent) => void): Promise<PluginListenerHandle>
}

export const yachiyoModelManagerNative = registerPlugin<NativeModelManagerPlugin>('YachiyoModelManager')

export function createNativeModelDownloadSink() {
  return {
    enqueue: (job: DownloadJob) => yachiyoModelManagerNative.enqueue({ jobId: job.id, modelId: job.modelId }).then(() => undefined),
    pause: (job: DownloadJob) => yachiyoModelManagerNative.pause({ jobId: job.id }).then(() => undefined),
    resume: (job: DownloadJob) => yachiyoModelManagerNative.resume({ jobId: job.id }).then(() => undefined),
    cancel: (job: DownloadJob) => yachiyoModelManagerNative.cancel({ jobId: job.id }).then(() => undefined),
  }
}

export class NativeLocalInferenceAdapter implements LocalInferenceAdapter {
  async isAvailable(modelId: string): Promise<boolean> {
    const result = await yachiyoModelManagerNative.healthCheck({ modelId })
    return result.status === 'supported' || result.status === 'warning'
  }

  async *stream(
    modelId: string,
    input: { messages: unknown[]; tools?: unknown; signal?: AbortSignal }
  ): AsyncGenerator<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; name: string; arguments: unknown; callId: string }
    | { type: 'status'; status: string }
  > {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const result = await yachiyoModelManagerNative.infer({ modelId, messages: input.messages, tools: input.tools })
    for (const event of result.events) {
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      // No event is executed here. Tool-call events are consumed by the model
      // orchestration layer and must pass the same Broker as cloud models.
      yield event
    }
  }

  async unload(modelId?: string): Promise<void> {
    // Native runtimes unload on memory pressure; keeping this optional avoids
    // inventing a second privileged command surface in the bridge.
    void modelId
  }
}

export function subscribeNativeModelProgress(listener: (event: NativeModelProgressEvent) => void): Promise<PluginListenerHandle> {
  return yachiyoModelManagerNative.addListener('progress', listener)
}
