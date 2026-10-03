import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { asSchema, type ToolSet } from 'ai'
import type { DeviceCompatibilityProfile, DownloadJob, ModelRuntime } from '@shared/models/model-catalog'
import type { LocalRuntimeCapabilities } from '@shared/models/local-capabilities'
import type { LocalInferenceAdapter } from '@shared/types/adapters'
import { createFeatureGatedPlugin } from './feature-gated-plugin'

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

export interface NativeModelLoadProgressEvent {
  modelId: string
  stage: 'starting' | 'loading' | 'generating' | 'embedding' | 'ready' | 'idle' | string
  percent: number
  indeterminate?: boolean
}

/** Token-level delta tailed from the isolated inference process's stream file. */
export interface NativeModelInferDeltaEvent {
  modelId: string
  requestId: string
  delta: string
}

export type NativeAccelerationMode = 'auto' | 'extreme'
export type NativeAccelerationBackend = 'auto' | 'cpu' | 'gpu' | 'npu'

export interface NativeAccelerationSettings {
  mode: NativeAccelerationMode
  requestedBackend: NativeAccelerationBackend
}

export interface NativeAccelerationBenchmark {
  backend?: NativeAccelerationBackend
  activeBackend?: string
  modelPath?: string
  initializationMs?: number
  firstTokenMs?: number
  prefillTokensPerSecond?: number
  decodeTokensPerSecond?: number
  residentBytes?: number
  gpuMemoryBytes?: number
  gpuLayers?: number
  offloadedLayers?: number
  cpuThreads?: number
  gpuDevice?: string
  thermalStatus?: number
  score?: number
  failureReason?: string
}

export interface NativeAccelerationProfile {
  schemaVersion: 1
  calibrationVersion?: string
  cacheKey: string
  mode: NativeAccelerationMode
  selectedBackend: Exclude<NativeAccelerationBackend, 'auto'>
  selectedModelPath: string
  modelVariant?: string
  declaredNpuCompatible?: boolean
  thermalStatus?: number
  profileKind?: 'safe-baseline' | 'verified-optimized' | 'deep-optimized'
  benchmarkElapsedMs?: number
  optimizedAt: number
  selected: NativeAccelerationBenchmark
  benchmarks: NativeAccelerationBenchmark[]
  screeningBenchmarks?: NativeAccelerationBenchmark[]
}

export interface NativeAccelerationRuntime extends NativeAccelerationBenchmark {
  requestedBackend?: NativeAccelerationBackend
  mode?: NativeAccelerationMode
  modelVariant?: string
  fallbackReason?: string
}

interface NativeModelManagerPlugin {
  list(): Promise<{ schemaVersion: 1; jobs: DownloadJob[] }>
  enqueue(options: { job: DownloadJob }): Promise<{ accepted: boolean; jobId: string }>
  pause(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  resume(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  cancel(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  reconcile(): Promise<{ schemaVersion: 1; recovered: number }>
  capabilities(): Promise<NativeModelManagerCapabilities>
  deviceProfile(): Promise<DeviceCompatibilityProfile>
  healthCheck(options: {
    modelId: string
  }): Promise<{ status: 'supported' | 'warning' | 'unsupported' | 'unknown'; reason?: string; runtime?: string }>
  modelCapabilities(options: { modelId: string }): Promise<LocalRuntimeCapabilities>
  infer(options: {
    modelId: string
    requestId: string
    messages: unknown[]
    tools?: unknown
    maxTokens?: number
  }): Promise<{
    events: Array<
      | { type: 'text'; text: string }
      | { type: 'tool-call'; name: string; arguments: unknown; callId: string }
      | { type: 'status'; status: string }
    >
  }>
  loadModel(options: { modelId: string }): Promise<NativeModelRuntimeState>
  runtimeState(options: { modelId: string }): Promise<NativeModelRuntimeState>
  accelerationSettings(options: { modelId: string }): Promise<NativeAccelerationSettings>
  setAccelerationSettings(options: {
    modelId: string
    mode: NativeAccelerationMode
    requestedBackend: NativeAccelerationBackend
  }): Promise<NativeAccelerationSettings>
  optimizeModel(options: { modelId: string }): Promise<NativeAccelerationProfile>
  cancelInference(options: { requestId: string }): Promise<{ cancelled: boolean }>
  embed(options: { modelId: string; texts: string[] }): Promise<{ modelId: string; embeddings: number[][] }>
  unload(options?: { modelId?: string }): Promise<void>
  deleteModel(options: { modelId: string }): Promise<void>
  addListener(eventName: 'progress', listener: (event: NativeModelProgressEvent) => void): Promise<PluginListenerHandle>
  addListener(
    eventName: 'loadProgress',
    listener: (event: NativeModelLoadProgressEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'inferDelta',
    listener: (event: NativeModelInferDeltaEvent) => void,
  ): Promise<PluginListenerHandle>
}

export interface NativeModelRuntimeState {
  modelId: string
  loaded: boolean
  runtime?: string
  eager?: boolean
  modelBytes?: number
  residentBytes?: number
  loadDurationMs?: number
  acceleration?: NativeAccelerationRuntime
}

export const yachiyoModelManagerNative = createFeatureGatedPlugin(
  'local-models',
  registerPlugin<NativeModelManagerPlugin>('YachiyoModelManager'),
)

export function createNativeModelDownloadSink() {
  return {
    enqueue: (job: DownloadJob) => yachiyoModelManagerNative.enqueue({ job }).then(() => undefined),
    pause: (job: DownloadJob) => yachiyoModelManagerNative.pause({ jobId: job.id }).then(() => undefined),
    resume: (job: DownloadJob) => yachiyoModelManagerNative.resume({ jobId: job.id }).then(() => undefined),
    cancel: (job: DownloadJob) => yachiyoModelManagerNative.cancel({ jobId: job.id }).then(() => undefined),
  }
}

/** Markup openers that must never leak into the live stream as partial text. */
const TOOL_MARKUP_OPENERS = ['<tool_call>', '<start_function_call>'] as const

/**
 * Length of the prefix of `text` that is safe to show immediately: everything
 * before the first complete markup opener, and before any trailing substring
 * that could still grow into one. Held-back text arrives via the final events.
 */
function streamSafeLength(text: string): number {
  let safe = text.length
  for (const opener of TOOL_MARKUP_OPENERS) {
    const complete = text.indexOf(opener)
    if (complete >= 0) safe = Math.min(safe, complete)
    // Only a suffix that is a strict prefix of an opener can still grow into
    // markup; hold back from its first possible start character.
    const earliest = Math.max(0, text.length - opener.length + 1)
    for (let start = earliest; start < text.length; start++) {
      if (text[start] === '<' && opener.startsWith(text.slice(start))) {
        safe = Math.min(safe, start)
        break
      }
    }
  }
  return safe
}

const STREAM_POLL_INTERVAL_MS = 60

export class NativeLocalInferenceAdapter implements LocalInferenceAdapter {
  async isAvailable(modelId: string): Promise<boolean> {
    return (await this.checkAvailability(modelId)).available
  }

  async checkAvailability(modelId: string): Promise<{ available: boolean; reason?: string; runtime?: string }> {
    const result = await yachiyoModelManagerNative.healthCheck({ modelId })
    return {
      available: result.status === 'supported' || result.status === 'warning',
      ...(result.reason ? { reason: result.reason } : {}),
      ...('runtime' in result && typeof result.runtime === 'string' ? { runtime: result.runtime } : {}),
    }
  }

  async *stream(
    modelId: string,
    input: { messages: unknown[]; tools?: unknown; maxTokens?: number; signal?: AbortSignal },
  ): AsyncGenerator<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; name: string; arguments: unknown; callId: string }
    | { type: 'status'; status: string }
  > {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const requestId = `local-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`
    const cancel = () => void yachiyoModelManagerNative.cancelInference({ requestId }).catch(() => undefined)
    input.signal?.addEventListener('abort', cancel, { once: true })

    type InferResult = Awaited<ReturnType<typeof yachiyoModelManagerNative.infer>>
    const deltas: string[] = []
    let settled = false
    let failure: unknown
    let finalResult: InferResult | undefined
    let listener: Awaited<ReturnType<typeof yachiyoModelManagerNative.addListener>> | undefined
    try {
      listener = await yachiyoModelManagerNative.addListener('inferDelta', (event) => {
        if (event.requestId === requestId && typeof event.delta === 'string' && event.delta) {
          deltas.push(event.delta)
        }
      })
    } catch {
      // The final native result remains authoritative when delta events are unavailable.
    }
    const inferPromise = yachiyoModelManagerNative
      .infer({
        modelId,
        requestId,
        messages: serializeLocalModelMessages(input.messages),
        tools: await serializeLocalTools(input.tools),
        maxTokens: input.maxTokens,
      })
      .then((result) => {
        finalResult = result
        settled = true
      })
      .catch((reason) => {
        failure = reason
        settled = true
      })

    let pending = ''
    let streamed = ''
    try {
      // Yield text while the isolated process is still sampling tokens.
      while (!settled || deltas.length > 0) {
        if (input.signal?.aborted) {
          void inferPromise.catch(() => undefined)
          throw new DOMException('Aborted', 'AbortError')
        }
        if (deltas.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_INTERVAL_MS))
          continue
        }
        pending += deltas.splice(0, deltas.length).join('')
        const safe = streamSafeLength(pending)
        if (safe > streamed.length) {
          const chunk = pending.slice(streamed.length, safe)
          streamed = pending.slice(0, safe)
          yield { type: 'text', text: chunk }
        }
      }
      if (failure) throw failure
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      // Reconcile with the authoritative parsed events: text already streamed
      // is emitted only once, markup never leaks, tool calls pass through.
      let remainderPending = true
      for (const event of finalResult?.events ?? []) {
        if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        // No event is executed here. Tool-call events are consumed by the model
        // orchestration layer and must pass the same Broker as cloud models.
        if (event.type === 'text') {
          if (!remainderPending) {
            yield event
            continue
          }
          remainderPending = false
          if (event.text.startsWith(streamed)) {
            const rest = event.text.slice(streamed.length)
            if (rest) yield { type: 'text', text: rest }
          } else if (!streamed) {
            yield event
          }
          // A streamed prefix that is not an event prefix means the runtime
          // rewrote the text; the streamed characters are already on screen.
        } else {
          yield event
        }
      }
    } finally {
      settled = true
      void inferPromise.catch(() => undefined)
      await listener?.remove().catch(() => undefined)
      input.signal?.removeEventListener('abort', cancel)
    }
  }

  async unload(modelId?: string): Promise<void> {
    await yachiyoModelManagerNative.unload({ modelId })
  }
}

/** Removes executable functions while preserving the descriptions and schemas the native model needs. */
export async function serializeLocalTools(tools: unknown): Promise<Record<string, unknown>> {
  if (!tools || typeof tools !== 'object') return {}
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(tools as ToolSet)) {
    if (!value || typeof value !== 'object' || !('inputSchema' in value) || typeof value.execute !== 'function') continue
    const schema = asSchema(value.inputSchema)
    result[name] = {
      description: typeof value.description === 'string' ? value.description : '',
      inputSchema: await schema.jsonSchema,
    }
  }
  return result
}

function mediaPayload(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const trimmed = value.trim()
  const dataUrl = trimmed.match(/^data:[^;,]+;base64,(.+)$/s)
  if (dataUrl) return dataUrl[1]
  if (/^(?:https?|file):/i.test(trimmed)) return undefined
  return trimmed
}

/** Converts AI SDK messages into a bounded JSON shape understood by the native runtimes. */
export function serializeLocalModelMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message
    const record = message as Record<string, unknown>
    if (!Array.isArray(record.content)) return { role: record.role, content: record.content }
    const content = record.content.flatMap((part): unknown[] => {
      if (!part || typeof part !== 'object') return []
      const item = part as Record<string, unknown>
      if (item.type === 'text' && typeof item.text === 'string') return [{ type: 'text', text: item.text }]
      if (item.type === 'reasoning' && typeof item.text === 'string') return [{ type: 'text', text: item.text }]
      if (item.type === 'image') {
        const data = mediaPayload(item.image)
        return data ? [{ type: 'image', data, mediaType: item.mediaType || 'image/jpeg' }] : []
      }
      if (item.type === 'file') {
        const data = mediaPayload(item.data)
        const mediaType = typeof item.mediaType === 'string' ? item.mediaType : 'application/octet-stream'
        if (!data) return []
        if (mediaType.startsWith('image/')) return [{ type: 'image', data, mediaType }]
        if (mediaType.startsWith('audio/')) return [{ type: 'audio', data, mediaType }]
      }
      if (item.type === 'tool-call' && typeof item.toolName === 'string') {
        return [{ type: 'tool-call', name: item.toolName, arguments: item.input ?? {} }]
      }
      if (item.type === 'tool-result') {
        return [{ type: 'tool-response', name: item.toolName, response: item.output ?? null }]
      }
      return []
    })
    return { role: record.role, content }
  })
}

function parseLocalEmbeddingModelId(model?: string): string | undefined {
  const normalized = model?.trim()
  if (!normalized) return undefined
  const separator = normalized.indexOf(':')
  if (separator < 0) return normalized
  const provider = normalized.slice(0, separator)
  return provider === 'yachiyo-local' ? normalized.slice(separator + 1) : undefined
}

/** Uses installed .tflite jobs only; cloud embedding model identifiers deliberately fall back to lexical RAG. */
export class NativeMobileRagEmbeddingProvider {
  async embed(params: { texts: string[]; model?: string }): Promise<number[][]> {
    let modelId = parseLocalEmbeddingModelId(params.model)
    if (!modelId) {
      if (params.model) throw new Error('mobile_rag_local_embedding_not_selected')
      const jobs = (await yachiyoModelManagerNative.list()).jobs
      modelId = jobs.find(
        (job) => job.status === 'completed' && job.artifacts.some((artifact) => artifact.format === 'tflite'),
      )?.modelId
    }
    if (!modelId) throw new Error('local_embedding_model_not_downloaded')
    return (await yachiyoModelManagerNative.embed({ modelId, texts: params.texts })).embeddings
  }
}

export const getNativeModelDeviceProfile = () => yachiyoModelManagerNative.deviceProfile()
export const listNativeModelJobs = () => yachiyoModelManagerNative.list()
export const deleteNativeModel = (modelId: string) => yachiyoModelManagerNative.deleteModel({ modelId })
export const loadNativeModel = (modelId: string) => yachiyoModelManagerNative.loadModel({ modelId })
export const getNativeModelRuntimeState = (modelId: string) => yachiyoModelManagerNative.runtimeState({ modelId })
export const getNativeModelAccelerationSettings = (modelId: string) =>
  yachiyoModelManagerNative.accelerationSettings({ modelId })
export const setNativeModelAccelerationSettings = (
  modelId: string,
  settings: NativeAccelerationSettings,
) => yachiyoModelManagerNative.setAccelerationSettings({ modelId, ...settings })
export const optimizeNativeModel = (modelId: string) => yachiyoModelManagerNative.optimizeModel({ modelId })

export function subscribeNativeModelProgress(
  listener: (event: NativeModelProgressEvent) => void,
): Promise<PluginListenerHandle> {
  return yachiyoModelManagerNative.addListener('progress', listener)
}

export function subscribeNativeModelLoadProgress(
  listener: (event: NativeModelLoadProgressEvent) => void,
): Promise<PluginListenerHandle> {
  return yachiyoModelManagerNative.addListener('loadProgress', listener)
}
