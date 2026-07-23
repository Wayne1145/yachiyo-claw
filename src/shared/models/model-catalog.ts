import { z } from 'zod'
import { LocalRuntimeCapabilitiesSchema, resolveLocalRuntimeCapabilities, type LocalRuntimeCapabilities } from './local-capabilities'

/**
 * The catalog intentionally knows about only the two runtimes that are part of
 * the mobile model roadmap. Native code owns the actual runtime and download
 * implementation; this module only supplies verified metadata and plans.
 */
export const MODEL_CATALOG_SOURCES = ['modelscope', 'huggingface'] as const
export type ModelCatalogSource = (typeof MODEL_CATALOG_SOURCES)[number]

export const MODEL_RUNTIMES = ['litert-lm', 'llama.cpp', 'mediapipe-text'] as const
export type ModelRuntime = (typeof MODEL_RUNTIMES)[number]

export const MODEL_FORMATS = ['litertlm', 'task', 'gguf', 'safetensors', 'onnx', 'tflite', 'bin', 'unknown'] as const
export type ModelFormat = (typeof MODEL_FORMATS)[number]

export const DOWNLOAD_JOB_STATUSES = ['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled'] as const
export type DownloadJobStatus = (typeof DOWNLOAD_JOB_STATUSES)[number]

export const COMPATIBILITY_STATUSES = ['supported', 'warning', 'unsupported', 'unknown'] as const
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number]

export interface ModelArtifact {
  /** Stable within a model revision. */
  id: string
  modelId: string
  source: ModelCatalogSource
  path: string
  /** Friendly alias retained for native/renderer callers. */
  filename: string
  url: string
  downloadUrl: string
  revision: string
  sha256?: string
  /** Alias for integrations that use a generic digest field. */
  hash?: string
  sizeBytes?: number
  /** Alias for upstream/API consumers. */
  size?: number
  format: ModelFormat
  runtime?: ModelRuntime
  required: boolean
  companion: boolean
  etag?: string
  metadata?: Record<string, unknown>
}

export interface RemoteModel {
  /** Repository identifier, for example `Qwen/Qwen2.5-1.5B-Instruct`. */
  id: string
  modelId: string
  source: ModelCatalogSource
  repository: string
  name: string
  displayName?: string
  description?: string
  revision: string
  /** True only when the revision is an immutable commit/revision identifier. */
  revisionPinned: boolean
  commitSha?: string
  license?: string
  licenseUrl?: string
  gated: boolean
  architecture: string[]
  parameterCount?: number
  quantization?: string
  tags: string[]
  formats: ModelFormat[]
  runtimeCandidates: ModelRuntime[]
  artifacts: ModelArtifact[]
  downloads?: number
  likes?: number
  createdAt?: string
  updatedAt?: string
  storageSizeBytes?: number
  minimumAndroidApi?: number
  supportedAbis?: string[]
  estimatedRamBytes?: number
  requiredStorageBytes?: number
  contextLength?: number
  capabilities?: string[]
  metadata?: Record<string, unknown>
}

export interface DeviceCompatibilityProfile {
  /** Android API level. `apiLevel` is accepted as a compatibility alias. */
  androidApi?: number
  apiLevel?: number
  abi?: string | string[]
  supportedAbis?: string[]
  availableRamBytes?: number
  ramBytes?: number
  availableStorageBytes?: number
  storageBytes?: number
  supportedRuntimes?: Array<ModelRuntime | string>
  runtimes?: Array<ModelRuntime | string>
  supportedFormats?: Array<ModelFormat | string>
  formats?: Array<ModelFormat | string>
  soc?: string
  cpu?: string
  gpu?: string
  npu?: string
}

export interface CompatibilityCheckSummary {
  androidApi: 'pass' | 'fail' | 'unknown'
  abi: 'pass' | 'fail' | 'unknown'
  ram: 'pass' | 'fail' | 'unknown'
  storage: 'pass' | 'fail' | 'unknown'
  format: 'pass' | 'fail' | 'unknown'
  runtime: 'pass' | 'fail' | 'unknown'
}

export interface CompatibilityIssue {
  code:
    | 'android_api_too_low'
    | 'abi_not_supported'
    | 'insufficient_ram'
    | 'insufficient_storage'
    | 'format_not_supported'
    | 'runtime_unavailable'
    | 'missing_artifact_metadata'
    | 'unknown_device_capability'
    | 'no_supported_artifact'
  message: string
  severity: 'warning' | 'error'
  runtime?: ModelRuntime
  format?: ModelFormat
}

export interface CompatibilityReport {
  modelId: string
  status: CompatibilityStatus
  runtime?: ModelRuntime
  format?: ModelFormat
  reasons: string[]
  /** Structured issues let UI/native callers avoid parsing human text. */
  issues: CompatibilityIssue[]
  warnings: string[]
  failures: string[]
  checks: CompatibilityCheckSummary
  requiredRamBytes?: number
  requiredStorageBytes?: number
  availableRamBytes?: number
  availableStorageBytes?: number
  checkedAt: number
}

export interface DownloadSegment {
  artifactId: string
  start: number
  end: number
  completedBytes: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'failed'
  etag?: string
}

export interface DownloadJob {
  id: string
  modelId: string
  source: ModelCatalogSource
  repository: string
  revision: string
  status: DownloadJobStatus
  artifactIds: string[]
  artifacts: ModelArtifact[]
  runtimeCapabilities?: LocalRuntimeCapabilities
  bytesTotal: number
  bytesDownloaded: number
  /** Native downloaders may use this as their upper bound. */
  maxConcurrentSegments: number
  segments: DownloadSegment[]
  targetDirectory?: string
  compatibility?: CompatibilityReport
  allowUnpinnedRevision: boolean
  createdAt: number
  updatedAt: number
  error?: { code: string; message: string; retryable?: boolean }
}

export interface ModelSearchOptions {
  query?: string
  page?: number
  limit?: number
  revision?: string
  includeArtifacts?: boolean
  signal?: AbortSignal
}

export interface GetModelOptions {
  revision?: string
  includeArtifacts?: boolean
  signal?: AbortSignal
}

export interface ModelCatalogAdapter {
  readonly source: ModelCatalogSource
  search(options?: ModelSearchOptions): Promise<RemoteModel[]>
  search(query: string, options?: Omit<ModelSearchOptions, 'query'>): Promise<RemoteModel[]>
  getModel(repository: string, options?: GetModelOptions): Promise<RemoteModel>
  listArtifacts(repository: string, revision?: string, signal?: AbortSignal): Promise<ModelArtifact[]>
}

export interface DownloadJobRequest {
  model: RemoteModel
  device?: DeviceCompatibilityProfile
  runtime?: ModelRuntime | string
  artifactIds?: string[]
  targetDirectory?: string
  allowUnpinnedRevision?: boolean
  allowIncompatible?: boolean
  maxConcurrentSegments?: number
  now?: number
}

export interface DownloadJobStore {
  save(job: DownloadJob): Promise<void> | void
  get(id: string): Promise<DownloadJob | undefined> | DownloadJob | undefined
  list(): Promise<DownloadJob[]> | DownloadJob[]
  delete?(id: string): Promise<void> | void
}

export interface DownloadJobSink {
  enqueue?(job: DownloadJob): Promise<void> | void
  pause?(job: DownloadJob): Promise<void> | void
  resume?(job: DownloadJob): Promise<void> | void
  cancel?(job: DownloadJob): Promise<void> | void
}

export interface ModelCatalogControllerOptions {
  adapters?: Partial<Record<ModelCatalogSource, ModelCatalogAdapter>>
  compatibilityEngine?: ModelCompatibilityEngine
  store?: DownloadJobStore
  sink?: DownloadJobSink
  now?: () => number
  createId?: () => string
}

export class ModelCatalogError extends Error {
  constructor(
    message: string,
    public readonly code: 'network' | 'http' | 'schema' | 'invalid_request',
    public readonly status?: number,
    public readonly url?: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ModelCatalogError'
  }
}

export class ModelCatalogSchemaError extends ModelCatalogError {
  constructor(message: string, url?: string, cause?: unknown) {
    super(message, 'schema', undefined, url, cause)
    this.name = 'ModelCatalogSchemaError'
  }
}

export type ModelCatalogFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const HEX_SHA256 = /^[a-f0-9]{64}$/i
const HEX_COMMIT = /^[a-f0-9]{7,64}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, context: string, url?: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ModelCatalogSchemaError(`${context} must be an object`, url)
  }
  return value
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asOptionalString).filter((item): item is string => Boolean(item))
}

function asIsoDate(value: unknown): string | undefined {
  const numeric = asOptionalNumber(value)
  if (numeric !== undefined) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const text = asOptionalString(value)
  if (!text) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function normalizeRepository(repository: string): string {
  const normalized = repository.trim().replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.includes('..') || normalized.includes('\\') || normalized.includes('?')) {
    throw new ModelCatalogError('invalid model repository', 'invalid_request')
  }
  return normalized
}

function encodeRepository(repository: string): string {
  return normalizeRepository(repository)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function normalizeRevision(revision: string | undefined, fallback: string): string {
  const normalized = revision?.trim()
  if (!normalized || normalized.includes('..') || normalized.includes('\\')) return fallback
  return normalized
}

function modelScopeRepositoryId(raw: Record<string, unknown>, fallback?: string): string | undefined {
  const explicit = asOptionalString(firstValue(raw, ['ModelId', 'modelId', 'model_id', 'Repository', 'repository']))
  if (explicit) return explicit
  const path = asOptionalString(firstValue(raw, ['Path', 'path', 'Namespace', 'namespace']))
  const name = asOptionalString(firstValue(raw, ['Name', 'name']))
  if (path && name) {
    if (path.includes('/') && (path.endsWith(`/${name}`) || path === name)) return path
    return `${path}/${name}`
  }
  if (path?.includes('/')) return path
  const id = asOptionalString(firstValue(raw, ['Id', 'id']))
  return id?.includes('/') ? id : (fallback ?? name ?? id)
}

function isPinnedRevision(revision: string | undefined): boolean {
  return Boolean(revision && HEX_COMMIT.test(revision))
}

function parseParameterCount(value: unknown, modelId?: string): number | undefined {
  const direct = asOptionalNumber(value)
  if (direct !== undefined && direct > 0) return direct
  const text = asOptionalString(value) ?? modelId
  if (!text) return undefined
  const match = text.match(/(?:^|[^\d])([\d]+(?:\.\d+)?)\s*([BM])(?:[^A-Za-z]|$)/i)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  return amount * (match[2].toUpperCase() === 'B' ? 1_000_000_000 : 1_000_000)
}

function inferFormat(pathOrTag: string): ModelFormat {
  const value = pathOrTag.toLowerCase()
  if (value === 'litertlm' || value.endsWith('.litertlm')) return 'litertlm'
  if (value === 'task' || value.endsWith('.task')) return 'task'
  if (value === 'gguf' || value.endsWith('.gguf')) return 'gguf'
  if (value.endsWith('.safetensors') || value.includes('safetensor')) return 'safetensors'
  if (value.endsWith('.onnx')) return 'onnx'
  if (value.endsWith('.tflite')) return 'tflite'
  if (value.endsWith('.bin')) return 'bin'
  return 'unknown'
}

function normalizeSha256(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(/^sha256:/i, '')
  return HEX_SHA256.test(normalized) ? normalized.toLowerCase() : undefined
}

function runtimeForFormat(format: ModelFormat): ModelRuntime | undefined {
  if (format === 'litertlm' || format === 'task') return 'litert-lm'
  if (format === 'gguf') return 'llama.cpp'
  if (format === 'tflite') return 'mediapipe-text'
  return undefined
}

function normalizeRuntime(value: unknown): ModelRuntime | undefined {
  const text = asOptionalString(value)?.toLowerCase()
  if (!text) return undefined
  if (text === 'litert-lm' || text === 'litertlm' || text === 'litert_lm' || text === 'litert') return 'litert-lm'
  if (text === 'llama.cpp' || text === 'llama-cpp' || text === 'llamacpp' || text === 'gguf') return 'llama.cpp'
  if (text === 'mediapipe-text' || text === 'mediapipe' || text === 'text-embedder' || text === 'tflite')
    return 'mediapipe-text'
  return undefined
}

function normalizeFormat(value: unknown): ModelFormat {
  const text = asOptionalString(value)?.toLowerCase()
  if (!text) return 'unknown'
  if (text === 'litertlm' || text === 'litert-lm') return 'litertlm'
  if (text === 'task') return 'task'
  if (text === 'gguf') return 'gguf'
  if (text === 'safetensors' || text === 'safetensor') return 'safetensors'
  if (text === 'onnx') return 'onnx'
  if (text === 'tflite' || text === 'tensorflowlite') return 'tflite'
  if (text === 'bin' || text === 'pytorch') return 'bin'
  return 'unknown'
}

function artifactIsRequired(path: string, format: ModelFormat): boolean {
  const lower = path.toLowerCase()
  if (format === 'litertlm' || format === 'task' || format === 'gguf') return true
  return (
    lower.includes('model') &&
    (format === 'safetensors' || format === 'onnx' || format === 'tflite' || format === 'bin')
  )
}

function artifactIsCompanion(path: string, format: ModelFormat): boolean {
  if (artifactIsRequired(path, format)) return false
  const lower = path.toLowerCase()
  return format !== 'unknown' || /(?:tokenizer|vocab|merges|config|generation_config|special_tokens)/.test(lower)
}

function buildArtifact(params: {
  modelId: string
  source: ModelCatalogSource
  revision: string
  path: string
  url: string
  sha256?: string
  sizeBytes?: number
  runtime?: ModelRuntime
  metadata?: Record<string, unknown>
}): ModelArtifact {
  const path = params.path.replace(/^\/+/, '')
  const format = inferFormat(path)
  const sha256 = normalizeSha256(params.sha256)
  const sizeBytes = params.sizeBytes !== undefined && params.sizeBytes >= 0 ? params.sizeBytes : undefined
  return {
    id: `${params.source}:${params.modelId}:${params.revision}:${path}`,
    modelId: params.modelId,
    source: params.source,
    path,
    filename: path,
    url: params.url,
    downloadUrl: params.url,
    revision: params.revision,
    sha256,
    hash: sha256,
    sizeBytes,
    size: sizeBytes,
    format,
    runtime: params.runtime ?? runtimeForFormat(format),
    required: artifactIsRequired(path, format),
    companion: artifactIsCompanion(path, format),
    metadata: params.metadata,
  }
}

function inferModelMetadata(params: {
  id: string
  source: ModelCatalogSource
  revision: string
  revisionPinned: boolean
  commitSha?: string
  description?: string
  license?: string
  licenseUrl?: string
  gated?: boolean
  architecture?: string[]
  parameterCount?: number
  quantization?: string
  tags?: string[]
  artifacts?: ModelArtifact[]
  downloads?: number
  likes?: number
  createdAt?: string
  updatedAt?: string
  storageSizeBytes?: number
  minimumAndroidApi?: number
  supportedAbis?: string[]
  estimatedRamBytes?: number
  requiredStorageBytes?: number
  contextLength?: number
  capabilities?: string[]
  metadata?: Record<string, unknown>
}): RemoteModel {
  const artifacts = params.artifacts ?? []
  const tags = unique((params.tags ?? []).map((tag) => tag.trim()).filter(Boolean))
  const formats = unique([...artifacts.map((artifact) => artifact.format), ...tags.map(inferFormat)]).filter(
    (format) => format !== 'unknown',
  )
  const runtimeCandidates = unique(
    [...artifacts.map((artifact) => artifact.runtime), ...formats.map(runtimeForFormat)].filter(
      (runtime): runtime is ModelRuntime => Boolean(runtime),
    ),
  )
  const inferredQuantization =
    params.quantization ??
    tags.find((tag) => /(?:q[2-8](?:_[kmf0-9]+)?|int(?:8|4)|awq|gptq|nf4)/i.test(tag)) ??
    artifacts
      .map((artifact) => artifact.path)
      .find((path) => /q[2-8](?:_[kmf0-9]+)?/i.test(path))
      ?.match(/q[2-8](?:_[kmf0-9]+)?/i)?.[0]
  const name = params.id.split('/').filter(Boolean).at(-1) ?? params.id
  const parameterCount = params.parameterCount ?? parseParameterCount(undefined, params.id)
  return {
    id: params.id,
    modelId: params.id,
    source: params.source,
    repository: params.id,
    name,
    displayName: name,
    description: params.description,
    revision: params.revision,
    revisionPinned: params.revisionPinned,
    commitSha: params.commitSha,
    license: params.license,
    licenseUrl: params.licenseUrl,
    gated: params.gated ?? false,
    architecture: unique(params.architecture ?? []),
    parameterCount,
    quantization: inferredQuantization,
    tags,
    formats,
    runtimeCandidates,
    artifacts,
    downloads: params.downloads,
    likes: params.likes,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    storageSizeBytes: params.storageSizeBytes,
    minimumAndroidApi: params.minimumAndroidApi,
    supportedAbis: params.supportedAbis,
    estimatedRamBytes: params.estimatedRamBytes,
    requiredStorageBytes: params.requiredStorageBytes,
    contextLength: params.contextLength,
    capabilities: params.capabilities,
    metadata: params.metadata,
  }
}

function parseFileLike(
  value: unknown,
  context: string,
  url?: string,
): { path: string; sha256?: string; sizeBytes?: number; metadata?: Record<string, unknown> } {
  if (typeof value === 'string') return { path: value }
  const object = asRecord(value, context, url)
  const path = asOptionalString(firstValue(object, ['path', 'rfilename', 'name', 'FileName', 'file_name', 'Path']))
  if (!path) throw new ModelCatalogSchemaError(`${context} is missing a file path`, url)
  const lfs = isRecord(object.lfs) ? object.lfs : undefined
  const sha256 = asOptionalString(
    firstValue(object, ['sha256', 'SHA256', 'sha', 'oid', 'hash']) ??
      (lfs ? firstValue(lfs, ['oid', 'sha256', 'sha']) : undefined),
  )
  const sizeBytes = asOptionalNumber(
    firstValue(object, ['size', 'sizeBytes', 'Size', 'file_size']) ??
      (lfs ? firstValue(lfs, ['size', 'sizeBytes']) : undefined),
  )
  return { path, sha256, sizeBytes, metadata: object }
}

function parseFileList(
  value: unknown,
  context: string,
  url?: string,
): Array<{ path: string; sha256?: string; sizeBytes?: number; metadata?: Record<string, unknown> }> {
  if (!Array.isArray(value)) {
    throw new ModelCatalogSchemaError(`${context} must be an array`, url)
  }
  return value.map((item, index) => parseFileLike(item, `${context}[${index}]`, url))
}

function modelScopeInfoFiles(info: Record<string, unknown>): unknown[] {
  const directFiles = firstValue(info, ['files', 'Files'])
  if (Array.isArray(directFiles)) return directFiles

  // ModelScope's GGUF metadata groups alternative quantizations, with each
  // group containing either one complete file or all shards for that variant.
  const groups = firstValue(info, ['gguf_file_list', 'GgufFileList'])
  if (!Array.isArray(groups)) return []
  return groups.flatMap((group) => {
    if (!isRecord(group)) return []
    const files = firstValue(group, ['file_info', 'FileInfo', 'files', 'Files'])
    return Array.isArray(files) ? files : []
  })
}

async function fetchJson(fetchImpl: ModelCatalogFetch, url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    throw new ModelCatalogError('model catalog request failed', 'network', undefined, url, error)
  }
  if (!response.ok) {
    throw new ModelCatalogError(`model catalog request returned HTTP ${response.status}`, 'http', response.status, url)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new ModelCatalogSchemaError('model catalog response was not valid JSON', url, error)
  }
}

function makeHeaders(token?: string, additional?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...additional,
  }
}

function assertModelScopeSuccess(payload: Record<string, unknown>, url: string): void {
  const code = asOptionalNumber(firstValue(payload, ['Code', 'code']))
  const success = asOptionalBoolean(firstValue(payload, ['Success', 'success']))
  if ((code !== undefined && code !== 200) || success === false) {
    const message = asOptionalString(firstValue(payload, ['Message', 'message'])) ?? 'ModelScope request failed'
    throw new ModelCatalogError(message, 'http', code, url)
  }
}

function parseHuggingFaceSiblings(
  raw: unknown,
  modelId: string,
  revision: string,
  baseUrl: string,
  url?: string,
): ModelArtifact[] {
  if (raw === undefined || raw === null) return []
  const files = parseFileList(raw, 'Hugging Face siblings', url)
  return files.map((file) =>
    buildArtifact({
      modelId,
      source: 'huggingface',
      revision,
      path: file.path,
      url: `${baseUrl}/${encodeRepository(modelId)}/resolve/${encodeURIComponent(revision)}/${encodePath(file.path)}?download=true`,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      metadata: file.metadata,
    }),
  )
}

const HuggingFaceModelResponseSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.record(z.string(), z.unknown()),
])
export { HuggingFaceModelResponseSchema }

export interface HuggingFaceAdapterOptions {
  fetch?: ModelCatalogFetch
  baseUrl?: string
  token?: string
  headers?: Record<string, string>
  defaultRevision?: string
}

export class HuggingFaceModelCatalogAdapter implements ModelCatalogAdapter {
  readonly source = 'huggingface' as const
  private readonly fetchImpl: ModelCatalogFetch
  private readonly baseUrl: string
  private readonly token?: string
  private readonly headers?: Record<string, string>
  private readonly defaultRevision: string

  constructor(options: HuggingFaceAdapterOptions | ModelCatalogFetch = {}) {
    const resolved = typeof options === 'function' ? { fetch: options } : options
    this.fetchImpl = resolved.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = (resolved.baseUrl ?? 'https://huggingface.co').replace(/\/$/, '')
    this.token = resolved.token
    this.headers = resolved.headers
    this.defaultRevision = normalizeRevision(resolved.defaultRevision, 'main')
  }

  async search(options?: ModelSearchOptions): Promise<RemoteModel[]>
  async search(query: string, options?: Omit<ModelSearchOptions, 'query'>): Promise<RemoteModel[]>
  async search(
    queryOrOptions: string | ModelSearchOptions = {},
    maybeOptions: Omit<ModelSearchOptions, 'query'> = {},
  ): Promise<RemoteModel[]> {
    const options: ModelSearchOptions =
      typeof queryOrOptions === 'string' ? { ...maybeOptions, query: queryOrOptions } : queryOrOptions
    const url = new URL(`${this.baseUrl}/api/models`)
    if (options.query?.trim()) url.searchParams.set('search', options.query.trim())
    url.searchParams.set('limit', String(Math.min(Math.max(options.limit ?? 20, 1), 100)))
    url.searchParams.set('full', 'true')
    url.searchParams.set('config', 'true')
    if (options.page && options.page > 1)
      url.searchParams.set('offset', String((options.page - 1) * Number(url.searchParams.get('limit'))))
    const payload = await fetchJson(this.fetchImpl, url.toString(), {
      method: 'GET',
      headers: makeHeaders(this.token, this.headers),
      signal: options.signal,
    })
    const parsed = HuggingFaceModelResponseSchema.safeParse(payload)
    if (!parsed.success)
      throw new ModelCatalogSchemaError('invalid Hugging Face model list response', url.toString(), parsed.error)
    const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data]
    return entries.map((entry) => this.normalizeModel(entry, options)).filter(Boolean)
  }

  async getModel(repository: string, options: GetModelOptions = {}): Promise<RemoteModel> {
    const modelId = normalizeRepository(repository)
    const url = new URL(`${this.baseUrl}/api/models/${encodeRepository(modelId)}`)
    url.searchParams.set('full', 'true')
    url.searchParams.set('config', 'true')
    if (options.revision) url.searchParams.set('revision', normalizeRevision(options.revision, this.defaultRevision))
    const payload = await fetchJson(this.fetchImpl, url.toString(), {
      method: 'GET',
      headers: makeHeaders(this.token, this.headers),
      signal: options.signal,
    })
    const parsed = asRecord(payload, 'Hugging Face model response', url.toString())
    const model = this.normalizeModel(parsed, options)
    const needsTree =
      options.includeArtifacts !== false &&
      (!model.artifacts.length ||
        model.artifacts.some((artifact) => artifact.required && (!artifact.sha256 || artifact.sizeBytes === undefined)))
    if (!needsTree) return model
    const artifacts = await this.listArtifacts(model.id, model.revision, options.signal)
    return {
      ...model,
      artifacts,
      formats: unique(artifacts.map((artifact) => artifact.format).filter((format) => format !== 'unknown')),
      runtimeCandidates: unique(
        artifacts.map((artifact) => artifact.runtime).filter((runtime): runtime is ModelRuntime => Boolean(runtime)),
      ),
      storageSizeBytes: artifacts.reduce((total, artifact) => total + (artifact.sizeBytes ?? 0), 0) || undefined,
    }
  }

  async listArtifacts(repository: string, revision?: string, signal?: AbortSignal): Promise<ModelArtifact[]> {
    const modelId = normalizeRepository(repository)
    const selectedRevision = normalizeRevision(revision, this.defaultRevision)
    const url = new URL(
      `${this.baseUrl}/api/models/${encodeRepository(modelId)}/tree/${encodeURIComponent(selectedRevision)}`,
    )
    url.searchParams.set('recursive', 'true')
    url.searchParams.set('expand', 'true')
    const payload = await fetchJson(this.fetchImpl, url.toString(), {
      method: 'GET',
      headers: makeHeaders(this.token, this.headers),
      signal,
    })
    const entries = Array.isArray(payload)
      ? payload
      : isRecord(payload)
        ? firstValue(payload, ['data', 'siblings', 'files'])
        : undefined
    return parseHuggingFaceSiblings(entries, modelId, selectedRevision, this.baseUrl, url.toString())
  }

  listModels(options?: ModelSearchOptions): Promise<RemoteModel[]> {
    return this.search(options)
  }

  fetchModels(options?: ModelSearchOptions): Promise<RemoteModel[]> {
    return this.search(options)
  }

  fetchModel(repository: string, options?: GetModelOptions): Promise<RemoteModel> {
    return this.getModel(repository, options)
  }

  getArtifacts(repository: string, revision?: string, signal?: AbortSignal): Promise<ModelArtifact[]> {
    return this.listArtifacts(repository, revision, signal)
  }

  private normalizeModel(raw: Record<string, unknown>, options: ModelSearchOptions | GetModelOptions): RemoteModel {
    const modelId = asOptionalString(firstValue(raw, ['id', 'modelId', 'model_id']))
    if (!modelId) throw new ModelCatalogSchemaError('Hugging Face model entry is missing id')
    const commitSha = asOptionalString(firstValue(raw, ['sha', 'commitSha', 'commit_sha']))
    const revision = normalizeRevision(commitSha ?? options.revision, this.defaultRevision)
    const cardData = isRecord(raw.cardData) ? raw.cardData : {}
    const config = isRecord(raw.config) ? raw.config : {}
    let artifacts =
      options.includeArtifacts === false ? [] : parseHuggingFaceSiblings(raw.siblings, modelId, revision, this.baseUrl)
    const tags = asStringArray(raw.tags)
    const architecture = unique([
      ...asStringArray(config.architectures),
      ...asStringArray(raw.architectures),
      ...tags.filter((tag) => /(?:architecture|arch):/i.test(tag)).map((tag) => tag.split(':').slice(1).join(':')),
    ])
    const license =
      asOptionalString(firstValue(cardData, ['license', 'license_name'])) ??
      asOptionalString(raw.license) ??
      tags.find((tag) => tag.toLowerCase().startsWith('license:'))?.slice('license:'.length)
    const parameterCount = parseParameterCount(
      firstValue(config, ['num_parameters', 'parameter_count', 'numParameters']) ??
        firstValue(raw, ['parameterCount', 'parameters']),
      modelId,
    )
    const quantization = asOptionalString(firstValue(config, ['quantization', 'quantization_config']))
    const description =
      asOptionalString(firstValue(cardData, ['summary', 'description'])) ?? asOptionalString(raw.description)
    const pipelineTag = asOptionalString(raw.pipeline_tag)
    const model = inferModelMetadata({
      id: modelId,
      source: 'huggingface',
      revision,
      revisionPinned: isPinnedRevision(commitSha ?? options.revision) || isPinnedRevision(revision),
      commitSha: commitSha && HEX_COMMIT.test(commitSha) ? commitSha : undefined,
      description,
      license,
      licenseUrl: asOptionalString(firstValue(cardData, ['license_link', 'licenseUrl'])),
      gated: asOptionalBoolean(raw.gated) ?? false,
      architecture,
      parameterCount,
      quantization,
      tags,
      artifacts,
      downloads: asOptionalNumber(raw.downloads),
      likes: asOptionalNumber(raw.likes),
      createdAt: asIsoDate(raw.createdAt ?? raw.created_at),
      updatedAt: asIsoDate(raw.lastModified ?? raw.last_modified),
      storageSizeBytes: artifacts.reduce((total, artifact) => total + (artifact.sizeBytes ?? 0), 0) || undefined,
      minimumAndroidApi: asOptionalNumber(firstValue(raw, ['minimumAndroidApi', 'min_android_api'])),
      supportedAbis: asStringArray(firstValue(raw, ['supportedAbis', 'supported_abis'])),
      estimatedRamBytes: asOptionalNumber(firstValue(raw, ['estimatedRamBytes', 'estimated_ram_bytes'])),
      requiredStorageBytes: asOptionalNumber(firstValue(raw, ['requiredStorageBytes', 'required_storage_bytes'])),
      contextLength: asOptionalNumber(firstValue(config, ['max_position_embeddings', 'context_length'])),
      capabilities: unique([...asStringArray(raw.capabilities), ...(pipelineTag ? [pipelineTag] : [])]),
      metadata: { raw: raw as Record<string, unknown> },
    })
    if (!artifacts.length && options.includeArtifacts !== false) {
      // `getModel` callers can request a complete tree lazily; search stays one request.
      // We cannot await here because normalizeModel is intentionally synchronous.
      artifacts = []
    }
    return { ...model, artifacts }
  }
}

export const HuggingFaceAdapter = HuggingFaceModelCatalogAdapter
export const HuggingFaceCatalogAdapter = HuggingFaceModelCatalogAdapter

export interface ModelScopeAdapterOptions {
  fetch?: ModelCatalogFetch
  baseUrl?: string
  token?: string
  headers?: Record<string, string>
  defaultRevision?: string
  /** Override the upstream search route while the public route evolves. */
  searchPath?: string
}

const ModelScopeResponseSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.record(z.string(), z.unknown()),
])
export { ModelScopeResponseSchema }

export class ModelScopeModelCatalogAdapter implements ModelCatalogAdapter {
  readonly source = 'modelscope' as const
  private readonly fetchImpl: ModelCatalogFetch
  private readonly baseUrl: string
  private readonly token?: string
  private readonly headers?: Record<string, string>
  private readonly defaultRevision: string
  private readonly searchPath: string

  constructor(options: ModelScopeAdapterOptions | ModelCatalogFetch = {}) {
    const resolved = typeof options === 'function' ? { fetch: options } : options
    this.fetchImpl = resolved.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = (resolved.baseUrl ?? 'https://www.modelscope.cn').replace(/\/$/, '')
    this.token = resolved.token
    this.headers = resolved.headers
    this.defaultRevision = normalizeRevision(resolved.defaultRevision, 'master')
    this.searchPath = resolved.searchPath ?? '/api/v1/dolphin/models'
  }

  async search(options?: ModelSearchOptions): Promise<RemoteModel[]>
  async search(query: string, options?: Omit<ModelSearchOptions, 'query'>): Promise<RemoteModel[]>
  async search(
    queryOrOptions: string | ModelSearchOptions = {},
    maybeOptions: Omit<ModelSearchOptions, 'query'> = {},
  ): Promise<RemoteModel[]> {
    const options: ModelSearchOptions =
      typeof queryOrOptions === 'string' ? { ...maybeOptions, query: queryOrOptions } : queryOrOptions
    const page = Math.max(options.page ?? 1, 1)
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
    const url = new URL(`${this.baseUrl}${this.searchPath.startsWith('/') ? '' : '/'}${this.searchPath}`)
    // The public model index moved from GET /api/v1/models to this Dolphin
    // endpoint in 2026. Detail and repository downloads remain under /api/v1/models.
    const requestBody = {
      PageNumber: page,
      PageSize: limit,
      SortBy: 'Default',
      Target: '',
      IsAigc: false,
      Name: options.query?.trim() ?? '',
      Criterion: [],
      SingleCriterion: [],
      IsStar: false,
    }
    const payload = await fetchJson(this.fetchImpl, url.toString(), {
      method: 'PUT',
      headers: { ...makeHeaders(this.token, this.headers), 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    })
    const parsed = ModelScopeResponseSchema.safeParse(payload)
    if (!parsed.success)
      throw new ModelCatalogSchemaError('invalid ModelScope model list response', url.toString(), parsed.error)
    if (!Array.isArray(parsed.data)) assertModelScopeSuccess(parsed.data, url.toString())
    const entries = this.extractListEntries(parsed.data, url.toString())
    return entries.map((entry) => this.normalizeSummary(entry, options))
  }

  async getModel(repository: string, options: GetModelOptions = {}): Promise<RemoteModel> {
    const modelId = normalizeRepository(repository)
    const selectedRevision = normalizeRevision(options.revision, this.defaultRevision)
    const url = `${this.baseUrl}/api/v1/models/${encodeRepository(modelId)}`
    const payload = await fetchJson(this.fetchImpl, url, {
      method: 'GET',
      headers: makeHeaders(this.token, this.headers),
      signal: options.signal,
    })
    const envelope = asRecord(payload, 'ModelScope model response', url)
    assertModelScopeSuccess(envelope, url)
    const dataValue = firstValue(envelope, ['Data', 'data'])
    if (dataValue !== undefined && !isRecord(dataValue)) {
      throw new ModelCatalogSchemaError('ModelScope model response data must be an object', url)
    }
    const data = isRecord(dataValue) ? dataValue : envelope
    return this.normalizeDetail(data, modelId, selectedRevision, options, url)
  }

  listModels(options?: ModelSearchOptions): Promise<RemoteModel[]> {
    return this.search(options)
  }

  fetchModels(options?: ModelSearchOptions): Promise<RemoteModel[]> {
    return this.search(options)
  }

  fetchModel(repository: string, options?: GetModelOptions): Promise<RemoteModel> {
    return this.getModel(repository, options)
  }

  async listArtifacts(repository: string, revision?: string, signal?: AbortSignal): Promise<ModelArtifact[]> {
    const model = await this.getModel(repository, { revision, includeArtifacts: true, signal })
    return model.artifacts
  }

  getArtifacts(repository: string, revision?: string, signal?: AbortSignal): Promise<ModelArtifact[]> {
    return this.listArtifacts(repository, revision, signal)
  }

  private extractListEntries(
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
    url: string,
  ): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload
    const data = firstValue(payload, ['Data', 'data', 'Models', 'models', 'Items', 'items', 'Result', 'result'])
    if (Array.isArray(data)) return data.filter(isRecord)
    if (isRecord(data)) {
      const nested = firstValue(data, ['Models', 'models', 'Model', 'model', 'Items', 'items', 'Result', 'result'])
      if (Array.isArray(nested)) return nested.filter(isRecord)
      if (isRecord(nested)) {
        const nestedEntries = firstValue(nested, ['Models', 'models', 'Items', 'items', 'Result', 'result'])
        if (Array.isArray(nestedEntries)) return nestedEntries.filter(isRecord)
        if (asOptionalString(firstValue(nested, ['Id', 'id', 'Path', 'path', 'Name', 'name']))) return [nested]
      }
      if (asOptionalString(firstValue(data, ['Id', 'id', 'Path', 'path', 'Name', 'name']))) return [data]
    }
    throw new ModelCatalogSchemaError('ModelScope model list has no model entries', url)
  }

  private normalizeSummary(raw: Record<string, unknown>, options: ModelSearchOptions): RemoteModel {
    const id = modelScopeRepositoryId(raw)
    if (!id) throw new ModelCatalogSchemaError('ModelScope model entry is missing id')
    const revision = normalizeRevision(
      asOptionalString(firstValue(raw, ['Revision', 'revision'])),
      options.revision ?? this.defaultRevision,
    )
    return this.normalizeDetail(raw, id, revision, options)
  }

  private normalizeDetail(
    raw: Record<string, unknown>,
    modelId: string,
    requestedRevision: string,
    _options: ModelSearchOptions | GetModelOptions,
    url?: string,
  ): RemoteModel {
    const revision = normalizeRevision(
      asOptionalString(firstValue(raw, ['Revision', 'revision', 'RevisionId', 'revision_id'])),
      requestedRevision,
    )
    const commitSha = asOptionalString(
      firstValue(raw, ['CommitSha', 'commitSha', 'CommitId', 'commit_id', 'Sha', 'sha']),
    )
    const modelInfosValue = firstValue(raw, ['ModelInfos', 'modelInfos', 'model_infos'])
    const modelInfos = isRecord(modelInfosValue) ? modelInfosValue : {}
    const artifacts: ModelArtifact[] = []
    for (const [formatName, infoValue] of Object.entries(modelInfos)) {
      if (_options.includeArtifacts === false) break
      if (!isRecord(infoValue)) continue
      const info = infoValue
      const files = modelScopeInfoFiles(info)
      if (!files.length) continue
      for (const file of parseFileList(files, `ModelScope ${formatName} files`, url)) {
        artifacts.push(
          buildArtifact({
            modelId,
            source: 'modelscope',
            revision,
            path: file.path,
            url: `${this.baseUrl}/api/v1/models/${encodeRepository(modelId)}/repo?Revision=${encodeURIComponent(revision)}&FilePath=${encodeURIComponent(file.path)}`,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            runtime: normalizeRuntime(formatName) ?? runtimeForFormat(inferFormat(file.path)),
            metadata: { ...file.metadata, modelInfo: info },
          }),
        )
      }
    }
    const tags = unique([
      ...asStringArray(firstValue(raw, ['Tags', 'tags'])),
      ...asStringArray(firstValue(raw, ['OfficialTags', 'official_tags'])),
    ])
    const architectures = asStringArray(firstValue(raw, ['Architectures', 'architectures']))
    const modelSize = asOptionalNumber(firstValue(raw, ['StorageSize', 'storageSize', 'storage_size']))
    const description = asOptionalString(firstValue(raw, ['Description', 'description', 'ReadMeContent', 'readme']))
    const license = asOptionalString(firstValue(raw, ['License', 'license', 'LicenseName', 'license_name']))
    const normalized = inferModelMetadata({
      id: modelId,
      source: 'modelscope',
      revision,
      revisionPinned:
        isPinnedRevision(commitSha ?? revision) ||
        (artifacts.length > 0 && artifacts.every((artifact) => Boolean(artifact.sha256))),
      commitSha: commitSha && HEX_COMMIT.test(commitSha) ? commitSha : undefined,
      description,
      license,
      licenseUrl: asOptionalString(firstValue(raw, ['LicenseLink', 'license_link'])),
      gated: asOptionalBoolean(firstValue(raw, ['ProtectedMode', 'protectedMode', 'Gated', 'gated'])) ?? false,
      architecture: architectures,
      parameterCount: parseParameterCount(
        firstValue(raw, ['ParameterCount', 'parameter_count', 'Parameters', 'parameters']),
        modelId,
      ),
      quantization: asOptionalString(firstValue(raw, ['Quantization', 'quantization'])),
      tags,
      artifacts,
      downloads: asOptionalNumber(firstValue(raw, ['Downloads', 'downloads'])),
      likes: asOptionalNumber(firstValue(raw, ['Stars', 'stars', 'Likes', 'likes'])),
      createdAt: asIsoDate(firstValue(raw, ['CreatedTime', 'createdTime', 'created_at'])),
      updatedAt: asIsoDate(firstValue(raw, ['LastUpdatedTime', 'lastUpdatedTime', 'last_updated'])),
      storageSizeBytes:
        modelSize ?? (artifacts.reduce((total, artifact) => total + (artifact.sizeBytes ?? 0), 0) || undefined),
      minimumAndroidApi: asOptionalNumber(
        firstValue(raw, ['MinimumAndroidApi', 'minimumAndroidApi', 'min_android_api']),
      ),
      supportedAbis: asStringArray(firstValue(raw, ['SupportedAbis', 'supportedAbis', 'supported_abis'])),
      estimatedRamBytes: asOptionalNumber(
        firstValue(raw, ['EstimatedRamBytes', 'estimatedRamBytes', 'estimated_ram_bytes']),
      ),
      requiredStorageBytes: asOptionalNumber(
        firstValue(raw, ['RequiredStorageBytes', 'requiredStorageBytes', 'required_storage_bytes']),
      ),
      capabilities: asStringArray(firstValue(raw, ['Tasks', 'tasks', 'Capabilities', 'capabilities'])),
      metadata: { raw },
    })
    return normalized
  }
}

export const ModelScopeAdapter = ModelScopeModelCatalogAdapter
export const ModelScopeCatalogAdapter = ModelScopeModelCatalogAdapter

interface CandidateEvaluation {
  status: CompatibilityStatus
  runtime?: ModelRuntime
  format?: ModelFormat
  issues: CompatibilityIssue[]
  requiredRamBytes?: number
  requiredStorageBytes?: number
  checks: CompatibilityCheckSummary
}

function statusRank(status: CompatibilityStatus): number {
  return { supported: 4, warning: 3, unknown: 2, unsupported: 1 }[status]
}

function normalizeAbis(profile: DeviceCompatibilityProfile): string[] {
  return [
    ...(Array.isArray(profile.abi) ? profile.abi : profile.abi ? [profile.abi] : []),
    ...(profile.supportedAbis ?? []),
  ]
    .map((abi) => abi.toLowerCase().trim())
    .filter(Boolean)
}

function normalizeRuntimes(profile: DeviceCompatibilityProfile): ModelRuntime[] {
  return [...(profile.supportedRuntimes ?? []), ...(profile.runtimes ?? [])]
    .map(normalizeRuntime)
    .filter((runtime): runtime is ModelRuntime => Boolean(runtime))
}

function normalizeFormats(profile: DeviceCompatibilityProfile): ModelFormat[] {
  return [...(profile.supportedFormats ?? []), ...(profile.formats ?? [])]
    .map(normalizeFormat)
    .filter((format) => format !== 'unknown')
}

function estimateRam(model: RemoteModel, artifact: ModelArtifact | undefined): number | undefined {
  if (model.estimatedRamBytes && model.estimatedRamBytes > 0) return model.estimatedRamBytes
  const size = artifact?.sizeBytes ?? model.storageSizeBytes
  if (!size || size <= 0) return undefined
  return Math.ceil(size * (artifact?.format === 'gguf' ? 1.35 : 1.25))
}

function estimateStorage(model: RemoteModel, artifact: ModelArtifact | undefined): number | undefined {
  if (model.requiredStorageBytes && model.requiredStorageBytes > 0) return model.requiredStorageBytes
  const required = model.artifacts.filter((item) => item.required || item === artifact)
  const total = required.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0)
  if (total > 0) return Math.ceil(total * 1.1)
  return model.storageSizeBytes && model.storageSizeBytes > 0 ? Math.ceil(model.storageSizeBytes * 1.1) : undefined
}

export class ModelCompatibilityEngine {
  constructor(
    private readonly options: {
      lowRamHeadroomRatio?: number
      lowStorageHeadroomRatio?: number
      defaultMinimumAndroidApi?: number
    } = {},
  ) {}

  check(model: RemoteModel, profile: DeviceCompatibilityProfile): CompatibilityReport {
    const runtimes = model.runtimeCandidates.length
      ? model.runtimeCandidates
      : unique(
          model.artifacts
            .map((artifact) => artifact.runtime)
            .filter((runtime): runtime is ModelRuntime => Boolean(runtime)),
        )
    const formats = model.formats.length ? model.formats : unique(model.artifacts.map((artifact) => artifact.format))
    const candidates = (runtimes.length ? runtimes : [undefined]).flatMap((runtime) =>
      (formats.length ? formats : [undefined]).map((format) => this.evaluateCandidate(model, profile, runtime, format)),
    )
    const selected = candidates.sort((a, b) => statusRank(b.status) - statusRank(a.status))[0] ?? {
      status: 'unknown' as const,
      issues: [],
      checks: {
        androidApi: 'unknown',
        abi: 'unknown',
        ram: 'unknown',
        storage: 'unknown',
        format: 'unknown',
        runtime: 'unknown',
      },
    }
    const warnings = selected.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)
    const failures = selected.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message)
    const reasons = selected.issues.map((issue) => issue.message)
    return {
      modelId: model.id,
      status: selected.status,
      runtime: selected.runtime,
      format: selected.format,
      reasons,
      issues: selected.issues,
      warnings,
      failures,
      checks: selected.checks,
      requiredRamBytes: selected.requiredRamBytes,
      requiredStorageBytes: selected.requiredStorageBytes,
      availableRamBytes: profile.availableRamBytes ?? profile.ramBytes,
      availableStorageBytes: profile.availableStorageBytes ?? profile.storageBytes,
      checkedAt: Date.now(),
    }
  }

  assess(model: RemoteModel, profile: DeviceCompatibilityProfile): CompatibilityReport {
    return this.check(model, profile)
  }

  private evaluateCandidate(
    model: RemoteModel,
    profile: DeviceCompatibilityProfile,
    runtime: ModelRuntime | undefined,
    format: ModelFormat | undefined,
  ): CandidateEvaluation {
    const issues: CompatibilityIssue[] = []
    const checks: CompatibilityCheckSummary = {
      androidApi: 'unknown',
      abi: 'unknown',
      ram: 'unknown',
      storage: 'unknown',
      format: 'unknown',
      runtime: 'unknown',
    }
    const artifact = model.artifacts.find((item) => item.format === format && (!runtime || item.runtime === runtime))
    const selectedRuntime = runtime ?? artifact?.runtime
    const selectedFormat = format ?? artifact?.format
    const deviceApi = profile.androidApi ?? profile.apiLevel
    // Android 11 (API 30) is the supported floor for the mobile app. A model
    // may raise this floor, but absent model metadata should not turn every
    // otherwise healthy device into an indeterminate result.
    const minimumApi = model.minimumAndroidApi ?? this.options.defaultMinimumAndroidApi ?? 30
    if (minimumApi !== undefined && deviceApi !== undefined) {
      checks.androidApi = deviceApi >= minimumApi ? 'pass' : 'fail'
      if (deviceApi < minimumApi)
        issues.push({
          code: 'android_api_too_low',
          message: `Android API ${deviceApi} is below required API ${minimumApi}`,
          severity: 'error',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
    } else {
      issues.push({
        code: 'unknown_device_capability',
        message: 'Android API level is not available',
        severity: 'warning',
        runtime: selectedRuntime,
        format: selectedFormat,
      })
    }
    const deviceAbis = normalizeAbis(profile)
    if (deviceAbis.length) {
      const modelAbis = model.supportedAbis?.length
        ? model.supportedAbis.map((abi) => abi.toLowerCase())
        : ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86']
      const match = modelAbis.some((abi) => deviceAbis.includes(abi))
      checks.abi = match ? 'pass' : 'fail'
      if (!match)
        issues.push({
          code: 'abi_not_supported',
          message: `Model does not support device ABI (${deviceAbis.join(', ')})`,
          severity: 'error',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
    } else {
      issues.push({
        code: 'unknown_device_capability',
        message: 'ABI compatibility is not fully known',
        severity: 'warning',
        runtime: selectedRuntime,
        format: selectedFormat,
      })
    }
    if (selectedRuntime) {
      const supportedRuntimes = normalizeRuntimes(profile)
      if (supportedRuntimes.length) {
        checks.runtime = supportedRuntimes.includes(selectedRuntime) ? 'pass' : 'fail'
        if (checks.runtime === 'fail')
          issues.push({
            code: 'runtime_unavailable',
            message: `Runtime ${selectedRuntime} is not available on this device`,
            severity: 'error',
            runtime: selectedRuntime,
            format: selectedFormat,
          })
      } else {
        issues.push({
          code: 'unknown_device_capability',
          message: `Runtime ${selectedRuntime} availability is not reported`,
          severity: 'warning',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
      }
    } else {
      checks.runtime = 'fail'
      issues.push({
        code: 'no_supported_artifact',
        message: 'No supported LiteRT-LM, llama.cpp, or MediaPipe Text artifact was found',
        severity: 'error',
      })
    }
    if (selectedFormat) {
      const supportedFormats = normalizeFormats(profile)
      const runtimeFormatSupported =
        selectedRuntime === 'litert-lm'
          ? selectedFormat === 'litertlm' || selectedFormat === 'task'
          : selectedRuntime === 'llama.cpp'
            ? selectedFormat === 'gguf'
            : selectedRuntime === 'mediapipe-text'
              ? selectedFormat === 'tflite'
              : false
      if (supportedFormats.length) {
        checks.format = supportedFormats.includes(selectedFormat) && runtimeFormatSupported ? 'pass' : 'fail'
      } else {
        checks.format = runtimeFormatSupported ? 'pass' : 'fail'
      }
      if (checks.format === 'fail')
        issues.push({
          code: 'format_not_supported',
          message: `Format ${selectedFormat} cannot run with ${selectedRuntime ?? 'the available runtimes'}`,
          severity: 'error',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
    } else {
      issues.push({
        code: 'no_supported_artifact',
        message: 'Model has no recognized mobile artifact',
        severity: 'error',
      })
    }
    const requiredRamBytes = estimateRam(model, artifact)
    // Android can reclaim cached/background memory before loading a model.
    // Total device RAM is the hard boundary; current free RAM only indicates
    // whether the user should close other apps before starting inference.
    const totalRamBytes = profile.ramBytes ?? profile.availableRamBytes
    const availableRamBytes = profile.availableRamBytes
    if (requiredRamBytes !== undefined && totalRamBytes !== undefined) {
      checks.ram = totalRamBytes >= requiredRamBytes ? 'pass' : 'fail'
      if (checks.ram === 'fail')
        issues.push({
          code: 'insufficient_ram',
          message: `Estimated RAM requirement (${requiredRamBytes} bytes) exceeds device RAM (${totalRamBytes} bytes)`,
          severity: 'error',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
      else if (
        availableRamBytes !== undefined &&
        availableRamBytes < requiredRamBytes * (1 + (this.options.lowRamHeadroomRatio ?? 0.15))
      )
        issues.push({
          code: 'unknown_device_capability',
          message: 'Current free RAM is low; Android may close background apps while loading this model',
          severity: 'warning',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
    } else {
      issues.push({
        code: 'missing_artifact_metadata',
        message: 'RAM requirement could not be estimated from model metadata',
        severity: 'warning',
        runtime: selectedRuntime,
        format: selectedFormat,
      })
    }
    const requiredStorageBytes = estimateStorage(model, artifact)
    const availableStorageBytes = profile.availableStorageBytes ?? profile.storageBytes
    if (requiredStorageBytes !== undefined && availableStorageBytes !== undefined) {
      checks.storage = availableStorageBytes >= requiredStorageBytes ? 'pass' : 'fail'
      if (checks.storage === 'fail')
        issues.push({
          code: 'insufficient_storage',
          message: `Required storage (${requiredStorageBytes} bytes) exceeds available storage (${availableStorageBytes} bytes)`,
          severity: 'error',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
      else if (availableStorageBytes < requiredStorageBytes * (1 + (this.options.lowStorageHeadroomRatio ?? 0.1)))
        issues.push({
          code: 'unknown_device_capability',
          message: 'Storage headroom is low for this model',
          severity: 'warning',
          runtime: selectedRuntime,
          format: selectedFormat,
        })
    } else {
      issues.push({
        code: 'missing_artifact_metadata',
        message: 'Storage requirement could not be estimated from model metadata',
        severity: 'warning',
        runtime: selectedRuntime,
        format: selectedFormat,
      })
    }
    const hasError = issues.some((issue) => issue.severity === 'error')
    const hasWarning = issues.some((issue) => issue.severity === 'warning')
    return {
      status: hasError ? 'unsupported' : hasWarning ? 'warning' : 'supported',
      runtime: selectedRuntime,
      format: selectedFormat,
      issues,
      requiredRamBytes,
      requiredStorageBytes,
      checks,
    }
  }
}

export function checkModelCompatibility(
  model: RemoteModel,
  profile: DeviceCompatibilityProfile,
  engine = new ModelCompatibilityEngine(),
): CompatibilityReport {
  return engine.check(model, profile)
}

function defaultJobId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `model-download-${Date.now().toString(36)}-${random}`
}

function cloneJob(job: DownloadJob): DownloadJob {
  return {
    ...job,
    artifacts: job.artifacts.map((artifact) => ({
      ...artifact,
      metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
    })),
    artifactIds: [...job.artifactIds],
    segments: job.segments.map((segment) => ({ ...segment })),
    compatibility: job.compatibility
      ? {
          ...job.compatibility,
          reasons: [...job.compatibility.reasons],
          issues: [...job.compatibility.issues],
          warnings: [...job.compatibility.warnings],
          failures: [...job.compatibility.failures],
        }
      : undefined,
  }
}

function selectDefaultArtifacts(artifacts: ModelArtifact[], runtime?: ModelRuntime): ModelArtifact[] {
  const candidates = artifacts.filter((artifact) => artifact.required && (!runtime || artifact.runtime === runtime))
  if (candidates.length <= 1) return artifacts

  const ggufShard = (artifact: ModelArtifact) =>
    (artifact.filename || artifact.path).match(/^(.*?)-(\d{5})-of-(\d{5})\.gguf$/i)
  const isPrimaryGguf = (artifact: ModelArtifact) =>
    artifact.format === 'gguf' &&
    !/(?:^|[._-])(mmproj|projector|vision|draft|speculative)(?:[._-]|$)/i.test(artifact.filename || artifact.path) &&
    (!ggufShard(artifact) || ggufShard(artifact)?.[2] === '00001')

  // Quantized GGUF/LiteRT files are alternative weights. Sharded safetensors
  // are not alternatives and therefore remain in the default set.
  const independentWeights = candidates.filter(
    (artifact) =>
      isPrimaryGguf(artifact) ||
      artifact.format === 'litertlm' ||
      artifact.format === 'task' ||
      artifact.format === 'tflite',
  )
  if (independentWeights.length <= 1) return artifacts
  const preferred =
    independentWeights.find((artifact) => /q4[_-]?k[_-]?m/i.test(artifact.path)) ??
    [...independentWeights].sort(
      (left, right) => (left.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (right.sizeBytes ?? Number.MAX_SAFE_INTEGER),
    )[0]
  const preferredShard = preferred ? ggufShard(preferred) : null
  const selectedIds = new Set(
    preferredShard
      ? artifacts
          .filter((artifact) => {
            const candidate = ggufShard(artifact)
            return Boolean(candidate && candidate[1] === preferredShard[1] && candidate[3] === preferredShard[3])
          })
          .map((artifact) => artifact.id)
      : preferred
        ? [preferred.id]
        : [],
  )
  return artifacts.filter((artifact) => {
    if (selectedIds.has(artifact.id)) return true
    if (artifact.format === 'gguf') return false
    return !artifact.required || !independentWeights.includes(artifact)
  })
}

export class ModelCatalogController {
  private readonly adapters: Partial<Record<ModelCatalogSource, ModelCatalogAdapter>>
  private readonly compatibilityEngine: ModelCompatibilityEngine
  private readonly store?: DownloadJobStore
  private readonly sink?: DownloadJobSink
  private readonly now: () => number
  private readonly createId: () => string
  private readonly memory = new Map<string, DownloadJob>()

  constructor(options: ModelCatalogControllerOptions = {}) {
    this.adapters = options.adapters ?? {}
    this.compatibilityEngine = options.compatibilityEngine ?? new ModelCompatibilityEngine()
    this.store = options.store
    this.sink = options.sink
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? defaultJobId
  }

  search(source: ModelCatalogSource, options?: ModelSearchOptions): Promise<RemoteModel[]> {
    const adapter = this.requireAdapter(source)
    return adapter.search(options)
  }

  searchModels(source: ModelCatalogSource, options?: ModelSearchOptions): Promise<RemoteModel[]> {
    return this.search(source, options)
  }

  getModel(source: ModelCatalogSource, repository: string, options?: GetModelOptions): Promise<RemoteModel> {
    return this.requireAdapter(source).getModel(repository, options)
  }

  checkCompatibility(model: RemoteModel, profile: DeviceCompatibilityProfile): CompatibilityReport {
    return this.compatibilityEngine.check(model, profile)
  }

  async createDownloadJob(request: DownloadJobRequest): Promise<DownloadJob> {
    if (!request.model.artifacts.length)
      throw new ModelCatalogError('model has no downloadable artifacts', 'invalid_request')
    const selectedRuntime = normalizeRuntime(request.runtime)
    let artifacts = request.model.artifacts.filter((artifact) => artifact.required || artifact.companion)
    if (selectedRuntime)
      artifacts = artifacts.filter((artifact) => !artifact.runtime || artifact.runtime === selectedRuntime)
    if (request.artifactIds?.length) {
      const ids = new Set(request.artifactIds)
      artifacts = request.model.artifacts.filter((artifact) => ids.has(artifact.id))
    } else {
      artifacts = selectDefaultArtifacts(artifacts, selectedRuntime)
    }
    if (!artifacts.length) throw new ModelCatalogError('no artifacts match the requested runtime', 'invalid_request')
    if (artifacts.some((artifact) => !artifact.sha256 || artifact.sizeBytes === undefined)) {
      throw new ModelCatalogError('download requires a size and SHA-256 for every artifact', 'invalid_request')
    }
    const allowUnpinnedRevision = request.allowUnpinnedRevision ?? false
    if (!allowUnpinnedRevision && !request.model.revisionPinned) {
      throw new ModelCatalogError('download requires an immutable model revision', 'invalid_request')
    }
    const compatibility = request.device ? this.checkCompatibility(request.model, request.device) : undefined
    if (compatibility?.status === 'unsupported' && !request.allowIncompatible) {
      throw new ModelCatalogError('model is not compatible with this device', 'invalid_request')
    }
    const timestamp = request.now ?? this.now()
    const bytesTotal = artifacts.reduce((total, artifact) => total + (artifact.sizeBytes ?? 0), 0)
    const job: DownloadJob = {
      id: this.createId(),
      modelId: request.model.id,
      source: request.model.source,
      repository: request.model.repository,
      revision: request.model.revision,
      status: 'queued',
      artifactIds: artifacts.map((artifact) => artifact.id),
      artifacts: artifacts.map((artifact) => ({ ...artifact })),
      runtimeCapabilities: resolveLocalRuntimeCapabilities(request.model, artifacts),
      bytesTotal,
      bytesDownloaded: 0,
      maxConcurrentSegments: Math.min(Math.max(request.maxConcurrentSegments ?? 4, 1), 4),
      segments: artifacts.map((artifact) => ({
        artifactId: artifact.id,
        start: 0,
        end: Math.max((artifact.sizeBytes ?? 1) - 1, 0),
        completedBytes: 0,
        status: 'pending',
      })),
      targetDirectory: request.targetDirectory,
      compatibility,
      allowUnpinnedRevision,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.persist(job)
    await this.sink?.enqueue?.(cloneJob(job))
    return cloneJob(job)
  }

  queueDownload(request: DownloadJobRequest): Promise<DownloadJob> {
    return this.createDownloadJob(request)
  }

  async getDownloadJob(id: string): Promise<DownloadJob | undefined> {
    const stored = await this.store?.get(id)
    const job = stored ?? this.memory.get(id)
    return job ? cloneJob(job) : undefined
  }

  async listDownloadJobs(): Promise<DownloadJob[]> {
    const stored = (await this.store?.list()) ?? []
    const merged = new Map<string, DownloadJob>(stored.map((job) => [job.id, job]))
    for (const [id, job] of this.memory) merged.set(id, job)
    return [...merged.values()].map(cloneJob)
  }

  pauseDownload(id: string): Promise<DownloadJob> {
    return this.transition(id, 'paused', this.sink?.pause)
  }

  resumeDownload(id: string): Promise<DownloadJob> {
    return this.transition(id, 'downloading', this.sink?.resume)
  }

  cancelDownload(id: string): Promise<DownloadJob> {
    return this.transition(id, 'cancelled', this.sink?.cancel)
  }

  /** Native workers can report progress without mutating artifact identity. */
  async updateDownloadJob(
    id: string,
    update: Partial<Pick<DownloadJob, 'status' | 'bytesDownloaded' | 'segments' | 'error'>>,
  ): Promise<DownloadJob> {
    const current = await this.getDownloadJob(id)
    if (!current) throw new ModelCatalogError('download job not found', 'invalid_request')
    if (
      update.bytesDownloaded !== undefined &&
      (update.bytesDownloaded < 0 || update.bytesDownloaded > current.bytesTotal)
    ) {
      throw new ModelCatalogError('invalid download progress', 'invalid_request')
    }
    const next: DownloadJob = {
      ...current,
      ...update,
      bytesDownloaded: update.bytesDownloaded ?? current.bytesDownloaded,
      segments: update.segments ? update.segments.map((segment) => ({ ...segment })) : current.segments,
      updatedAt: this.now(),
    }
    await this.persist(next)
    return cloneJob(next)
  }

  private requireAdapter(source: ModelCatalogSource): ModelCatalogAdapter {
    const adapter = this.adapters[source]
    if (!adapter) throw new ModelCatalogError(`no ${source} model catalog adapter is configured`, 'invalid_request')
    return adapter
  }

  private async persist(job: DownloadJob): Promise<void> {
    this.memory.set(job.id, cloneJob(job))
    await this.store?.save(cloneJob(job))
  }

  private async transition(
    id: string,
    status: DownloadJobStatus,
    callback?: (job: DownloadJob) => Promise<void> | void,
  ): Promise<DownloadJob> {
    const current = await this.getDownloadJob(id)
    if (!current) throw new ModelCatalogError('download job not found', 'invalid_request')
    if (current.status === 'completed' || current.status === 'cancelled') return current
    const next = { ...current, status, updatedAt: this.now() }
    await this.persist(next)
    await callback?.(cloneJob(next))
    return cloneJob(next)
  }
}

export const ModelManagerController = ModelCatalogController

export const ModelArtifactSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  source: z.enum(MODEL_CATALOG_SOURCES),
  path: z.string(),
  filename: z.string(),
  url: z.string(),
  downloadUrl: z.string(),
  revision: z.string(),
  sha256: z.string().optional(),
  hash: z.string().optional(),
  sizeBytes: z.number().optional(),
  size: z.number().optional(),
  format: z.enum(MODEL_FORMATS),
  runtime: z.enum(MODEL_RUNTIMES).optional(),
  required: z.boolean(),
  companion: z.boolean(),
  etag: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const RemoteModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  source: z.enum(MODEL_CATALOG_SOURCES),
  repository: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  revision: z.string(),
  revisionPinned: z.boolean(),
  commitSha: z.string().optional(),
  license: z.string().optional(),
  licenseUrl: z.string().optional(),
  gated: z.boolean(),
  architecture: z.array(z.string()),
  parameterCount: z.number().optional(),
  quantization: z.string().optional(),
  tags: z.array(z.string()),
  formats: z.array(z.enum(MODEL_FORMATS)),
  runtimeCandidates: z.array(z.enum(MODEL_RUNTIMES)),
  artifacts: z.array(ModelArtifactSchema),
  downloads: z.number().optional(),
  likes: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  storageSizeBytes: z.number().optional(),
  minimumAndroidApi: z.number().optional(),
  supportedAbis: z.array(z.string()).optional(),
  estimatedRamBytes: z.number().optional(),
  requiredStorageBytes: z.number().optional(),
  contextLength: z.number().optional(),
  capabilities: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const CompatibilityIssueSchema = z.object({
  code: z.enum([
    'android_api_too_low',
    'abi_not_supported',
    'insufficient_ram',
    'insufficient_storage',
    'format_not_supported',
    'runtime_unavailable',
    'missing_artifact_metadata',
    'unknown_device_capability',
    'no_supported_artifact',
  ]),
  message: z.string(),
  severity: z.enum(['warning', 'error']),
  runtime: z.enum(MODEL_RUNTIMES).optional(),
  format: z.enum(MODEL_FORMATS).optional(),
})

const CompatibilityCheckValueSchema = z.enum(['pass', 'fail', 'unknown'])

export const CompatibilityReportSchema = z.object({
  modelId: z.string(),
  status: z.enum(COMPATIBILITY_STATUSES),
  runtime: z.enum(MODEL_RUNTIMES).optional(),
  format: z.enum(MODEL_FORMATS).optional(),
  reasons: z.array(z.string()),
  issues: z.array(CompatibilityIssueSchema),
  warnings: z.array(z.string()),
  failures: z.array(z.string()),
  checks: z.object({
    androidApi: CompatibilityCheckValueSchema,
    abi: CompatibilityCheckValueSchema,
    ram: CompatibilityCheckValueSchema,
    storage: CompatibilityCheckValueSchema,
    format: CompatibilityCheckValueSchema,
    runtime: CompatibilityCheckValueSchema,
  }),
  requiredRamBytes: z.number().nonnegative().optional(),
  requiredStorageBytes: z.number().nonnegative().optional(),
  availableRamBytes: z.number().nonnegative().optional(),
  availableStorageBytes: z.number().nonnegative().optional(),
  checkedAt: z.number(),
})

export const DownloadSegmentSchema = z.object({
  artifactId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  completedBytes: z.number().int().nonnegative(),
  status: z.enum(['pending', 'downloading', 'paused', 'completed', 'failed']),
  etag: z.string().optional(),
})

export const DownloadJobSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  source: z.enum(MODEL_CATALOG_SOURCES),
  repository: z.string(),
  revision: z.string(),
  status: z.enum(DOWNLOAD_JOB_STATUSES),
  artifactIds: z.array(z.string()),
  artifacts: z.array(ModelArtifactSchema),
  runtimeCapabilities: LocalRuntimeCapabilitiesSchema.optional(),
  bytesTotal: z.number().int().nonnegative(),
  bytesDownloaded: z.number().int().nonnegative(),
  maxConcurrentSegments: z.number().int().min(1).max(4),
  segments: z.array(DownloadSegmentSchema),
  targetDirectory: z.string().optional(),
  compatibility: CompatibilityReportSchema.optional(),
  allowUnpinnedRevision: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
    })
    .optional(),
})

export type ValidatedRemoteModel = z.infer<typeof RemoteModelSchema>
export type AndroidModelDeviceProfile = DeviceCompatibilityProfile

export function validateRemoteModel(value: unknown): RemoteModel {
  return RemoteModelSchema.parse(value) as RemoteModel
}

export function validateDownloadJob(value: unknown): DownloadJob {
  return DownloadJobSchema.parse(value) as DownloadJob
}

export const assessModelCompatibility = checkModelCompatibility
