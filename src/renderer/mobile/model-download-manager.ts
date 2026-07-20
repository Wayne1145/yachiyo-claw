import type { DownloadJob, DownloadSegment, ModelArtifact } from '@shared/models/model-catalog'

export interface DownloadByteStore {
  /** Writes into a job-scoped temporary file at an absolute byte offset. */
  write(jobId: string, artifactId: string, offset: number, bytes: Uint8Array): Promise<void>
  read(jobId: string, artifactId: string): Promise<Uint8Array>
  finalize(jobId: string, artifactId: string, filename: string): Promise<void>
  discard?(jobId: string, artifactId: string): Promise<void>
}

export interface DownloadProgress {
  job: DownloadJob
  artifactId?: string
  segment?: DownloadSegment
}

export interface ModelDownloadManagerOptions {
  store: DownloadByteStore
  fetchImpl?: typeof fetch
  maxConcurrentFiles?: number
  maxConcurrentSegments?: number
  maxRetries?: number
  sleep?: (milliseconds: number) => Promise<void>
  resolveUrl?: (artifact: ModelArtifact) => Promise<string> | string
  hasFreeSpace?: (requiredBytes: number) => Promise<boolean> | boolean
  onProgress?: (progress: DownloadProgress) => void | Promise<void>
}

export class ModelDownloadError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'ModelDownloadError'
  }
}

const MAX_SEGMENTS = 4
const MAX_FILES = 2
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const SECRET_QUERY = /(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization)/i

export function isRetryableDownloadStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500
}

export function splitDownloadRange(size: number, requestedSegments = MAX_SEGMENTS): Array<{ start: number; end: number }> {
  if (!Number.isSafeInteger(size) || size <= 0) throw new ModelDownloadError('invalid artifact size', 'invalid_size')
  const count = Math.min(Math.max(Math.floor(requestedSegments), 1), MAX_SEGMENTS, size)
  const baseSize = Math.floor(size / count)
  const remainder = size % count
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let index = 0; index < count; index += 1) {
    const length = baseSize + (index < remainder ? 1 : 0)
    ranges.push({ start, end: start + length - 1 })
    start += length
  }
  return ranges
}

export function validateDownloadArtifact(artifact: ModelArtifact, allowUnpinnedRevision = false): void {
  if (!artifact.id || !artifact.modelId || !artifact.path) throw new ModelDownloadError('artifact identity is incomplete', 'manifest_invalid')
  const normalizedPath = artifact.path.replace(/\\/g, '/')
  if (normalizedPath.startsWith('/') || normalizedPath.split('/').some((part) => part === '..' || part === '.')) {
    throw new ModelDownloadError('artifact path traversal rejected', 'manifest_path_invalid')
  }
  if (!artifact.url || !artifact.downloadUrl) throw new ModelDownloadError('artifact URL is missing', 'manifest_url_missing')
  let url: URL
  try {
    url = new URL(artifact.downloadUrl)
  } catch {
    throw new ModelDownloadError('artifact URL is invalid', 'manifest_url_invalid')
  }
  if (url.protocol !== 'https:') throw new ModelDownloadError('model downloads require HTTPS', 'manifest_https_required')
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY.test(key)) throw new ModelDownloadError('model token must not be placed in URL query', 'manifest_secret_query')
  }
  if (!allowUnpinnedRevision && (!artifact.revision || artifact.revision === 'main' || artifact.revision === 'master')) {
    throw new ModelDownloadError('download requires a pinned revision', 'revision_unpinned')
  }
  if (!artifact.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new ModelDownloadError('artifact SHA-256 is required', 'manifest_hash_missing')
  }
  const sizeBytes = artifact.sizeBytes
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes === undefined || sizeBytes <= 0) {
    throw new ModelDownloadError('artifact size is required', 'manifest_size_missing')
  }
}

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000)
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.min(60_000, Math.max(0, date - Date.now()))
  }
  return Math.min(60_000, 500 * 2 ** Math.min(attempt, 7))
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cloneJob(job: DownloadJob): DownloadJob {
  return {
    ...job,
    artifacts: job.artifacts.map((artifact) => ({ ...artifact })),
    artifactIds: [...job.artifactIds],
    segments: job.segments.map((segment) => ({ ...segment })),
    compatibility: job.compatibility
      ? {
          ...job.compatibility,
          reasons: [...job.compatibility.reasons],
          warnings: [...job.compatibility.warnings],
          failures: [...job.compatibility.failures],
          issues: [...job.compatibility.issues],
          checks: { ...job.compatibility.checks },
        }
      : undefined,
  }
}

/**
 * Resumable downloader used by the native WorkManager bridge and web tests.
 * The store owns temporary files; this class never puts credentials in job data.
 */
export class ModelDownloadManager {
  private readonly fetchImpl: typeof fetch
  private readonly maxFiles: number
  private readonly maxSegments: number
  private readonly maxRetries: number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly resolveUrl: (artifact: ModelArtifact) => Promise<string>
  private readonly hasFreeSpace?: (requiredBytes: number) => Promise<boolean>
  private readonly onProgress?: (progress: DownloadProgress) => void | Promise<void>

  constructor(private readonly options: ModelDownloadManagerOptions) {
    this.fetchImpl = options.fetchImpl || fetch
    this.maxFiles = Math.min(Math.max(options.maxConcurrentFiles ?? MAX_FILES, 1), MAX_FILES)
    this.maxSegments = Math.min(Math.max(options.maxConcurrentSegments ?? MAX_SEGMENTS, 1), MAX_SEGMENTS)
    this.maxRetries = Math.min(Math.max(options.maxRetries ?? 4, 0), 8)
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.resolveUrl = async (artifact) => options.resolveUrl ? options.resolveUrl(artifact) : artifact.downloadUrl
    this.hasFreeSpace = options.hasFreeSpace ? async (bytes) => options.hasFreeSpace!(bytes) : undefined
    this.onProgress = options.onProgress
  }

  async download(jobInput: DownloadJob, signal?: AbortSignal): Promise<DownloadJob> {
    const job = cloneJob(jobInput)
    if (job.status === 'completed') return job
    if (job.status === 'cancelled') throw new ModelDownloadError('download is cancelled', 'cancelled')
    if (this.hasFreeSpace && !(await this.hasFreeSpace(Math.ceil(job.bytesTotal * 1.1)))) {
      throw new ModelDownloadError('not enough free storage', 'low_disk', false)
    }
    job.status = 'downloading'
    await this.emit(job)
    const pending = job.artifacts.filter((artifact) => job.artifactIds.includes(artifact.id))
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const artifact = pending[cursor++]
        await this.downloadArtifact(job, artifact, signal)
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(this.maxFiles, pending.length) }, () => worker()))
      job.bytesDownloaded = job.bytesTotal
      job.status = 'completed'
      job.error = undefined
      await this.emit(job)
      return job
    } catch (error) {
      if (isAbort(error) || signal?.aborted) {
        job.status = 'paused'
        job.error = { code: 'paused', message: 'download_paused', retryable: true }
      } else if (error instanceof ModelDownloadError) {
        job.status = error.code === 'cancelled' ? 'cancelled' : 'failed'
        job.error = { code: error.code, message: error.message, retryable: error.retryable }
      } else {
        job.status = 'failed'
        job.error = { code: 'download_failed', message: 'download_failed', retryable: true }
      }
      await this.emit(job)
      throw error
    }
  }

  private async downloadArtifact(job: DownloadJob, artifact: ModelArtifact, signal?: AbortSignal): Promise<void> {
    validateDownloadArtifact(artifact, job.allowUnpinnedRevision)
    const url = await this.resolveUrl(artifact)
    const size = artifact.sizeBytes
    if (size === undefined) throw new ModelDownloadError('artifact size is required', 'manifest_size_missing')
    let segments = job.segments.filter((segment) => segment.artifactId === artifact.id)
    const supportsRange = await this.probeRange(url, size, signal)
    if (!supportsRange) {
      segments = [{ artifactId: artifact.id, start: 0, end: size - 1, completedBytes: 0, status: 'pending' }]
      job.segments = [...job.segments.filter((segment) => segment.artifactId !== artifact.id), ...segments]
      await this.downloadSequential(job, artifact, url, signal)
      return
    }
    if (segments.length <= 1 && segments[0]?.end === size - 1 && segments[0]?.start === 0) {
      segments = splitDownloadRange(size, this.maxSegments).map((range) => ({
        artifactId: artifact.id,
        ...range,
        completedBytes: 0,
        status: 'pending' as const,
      }))
      job.segments = [...job.segments.filter((segment) => segment.artifactId !== artifact.id), ...segments]
    }
    let next = 0
    const runSegment = async () => {
      while (next < segments.length) {
        const index = next++
        await this.downloadSegment(job, artifact, url, segments[index], index, signal)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.maxSegments, segments.length) }, runSegment))
    const bytes = await this.options.store.read(job.id, artifact.id)
    if (bytes.byteLength !== size) throw new ModelDownloadError('download size mismatch', 'size_mismatch')
    const etags = new Set(segments.map((segment) => segment.etag).filter((etag): etag is string => Boolean(etag)))
    if (etags.size > 1 || (artifact.etag && etags.size === 1 && !etags.has(artifact.etag))) {
      await this.options.store.discard?.(job.id, artifact.id)
      throw new ModelDownloadError('artifact ETag changed during download', 'etag_mismatch')
    }
    await this.verifyArtifact(job.id, artifact, bytes)
    await this.options.store.finalize(job.id, artifact.id, artifact.filename)
  }

  private async downloadSequential(job: DownloadJob, artifact: ModelArtifact, url: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchWithRetry(url, undefined, signal)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== artifact.sizeBytes) throw new ModelDownloadError('download size mismatch', 'size_mismatch')
    await this.options.store.write(job.id, artifact.id, 0, bytes)
    const segment = job.segments.find((item) => item.artifactId === artifact.id)
    if (segment) {
      segment.completedBytes = bytes.byteLength
      segment.status = 'completed'
    }
    await this.updateBytes(job)
    const responseEtag = response.headers.get('etag')
    if (artifact.etag && responseEtag && artifact.etag !== responseEtag) {
      await this.options.store.discard?.(job.id, artifact.id)
      throw new ModelDownloadError('artifact ETag changed during download', 'etag_mismatch')
    }
    await this.verifyArtifact(job.id, artifact, bytes)
    await this.options.store.finalize(job.id, artifact.id, artifact.filename)
  }

  private async downloadSegment(
    job: DownloadJob,
    artifact: ModelArtifact,
    url: string,
    segment: DownloadSegment,
    segmentIndex: number,
    signal?: AbortSignal
  ): Promise<void> {
    const expectedStart = segment.start + Math.max(0, segment.completedBytes)
    if (expectedStart > segment.end) {
      segment.status = 'completed'
      return
    }
    segment.status = 'downloading'
    await this.emit(job, artifact.id, segment)
    const response = await this.fetchWithRetry(url, { Range: `bytes=${expectedStart}-${segment.end}` }, signal)
    if (response.status === 200 && expectedStart !== 0) {
      throw new ModelDownloadError('server does not support byte ranges', 'range_unsupported')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const expectedLength = segment.end - expectedStart + 1
    if (bytes.byteLength !== expectedLength && !(response.status === 200 && expectedStart === 0 && segment.start === 0)) {
      throw new ModelDownloadError('range response size mismatch', 'range_size_mismatch')
    }
    await this.options.store.write(job.id, artifact.id, expectedStart, bytes)
    segment.completedBytes = expectedStart - segment.start + bytes.byteLength
    segment.status = 'completed'
    segment.etag = response.headers.get('etag') || segment.etag
    await this.updateBytes(job)
    await this.emit(job, artifact.id, segment)
    void segmentIndex
  }

  private async probeRange(url: string, size: number, signal?: AbortSignal): Promise<boolean> {
    try {
      const head = await this.fetchWithRetry(url, undefined, signal, 'HEAD')
      const accepts = head.headers.get('accept-ranges')?.toLowerCase().includes('bytes')
      if (accepts) return true
      // A 206 probe is more reliable than a missing Accept-Ranges header.
      const probe = await this.fetchWithRetry(url, { Range: 'bytes=0-0' }, signal)
      return probe.status === 206 && size > 1
    } catch (error) {
      if (error instanceof ModelDownloadError && error.status === 405) return false
      throw error
    }
  }

  private async fetchWithRetry(
    url: string,
    headers?: Record<string, string>,
    signal?: AbortSignal,
    method = 'GET'
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: { Accept: 'application/octet-stream', ...(headers || {}) },
          signal,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        })
        if (response.ok) return response
        const retryable = isRetryableDownloadStatus(response.status)
        if (!retryable || attempt >= this.maxRetries) {
          throw new ModelDownloadError(`download_http_${response.status}`, `http_${response.status}`, retryable, response.status)
        }
        await this.sleep(retryAfterMilliseconds(response, attempt))
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw error
        if (error instanceof ModelDownloadError) throw error
        if (attempt >= this.maxRetries) throw new ModelDownloadError('download_network_failed', 'network', true)
        await this.sleep(Math.min(60_000, 500 * 2 ** attempt))
      }
    }
  }

  private async verifyArtifact(jobId: string, artifact: ModelArtifact, bytes: Uint8Array): Promise<void> {
    const actual = await sha256Hex(bytes)
    if (actual.toLowerCase() !== artifact.sha256!.toLowerCase()) {
      await this.options.store.discard?.(jobId, artifact.id)
      throw new ModelDownloadError('artifact SHA-256 mismatch', 'hash_mismatch')
    }
  }

  private async updateBytes(job: DownloadJob): Promise<void> {
    job.bytesDownloaded = Math.min(
      job.bytesTotal,
      job.segments.reduce((total, segment) => total + Math.max(0, segment.completedBytes), 0)
    )
    job.updatedAt = Date.now()
  }

  private async emit(job: DownloadJob, artifactId?: string, segment?: DownloadSegment): Promise<void> {
    await this.onProgress?.({ job: cloneJob(job), artifactId, segment: segment ? { ...segment } : undefined })
  }
}

/** A deterministic in-memory store used by tests and non-native previews. */
export class MemoryDownloadByteStore implements DownloadByteStore {
  private readonly values = new Map<string, Uint8Array>()

  async write(jobId: string, artifactId: string, offset: number, bytes: Uint8Array): Promise<void> {
    const key = `${jobId}:${artifactId}`
    const previous = this.values.get(key) || new Uint8Array(0)
    const next = new Uint8Array(Math.max(previous.byteLength, offset + bytes.byteLength))
    next.set(previous)
    next.set(bytes, offset)
    this.values.set(key, next)
  }

  async read(jobId: string, artifactId: string): Promise<Uint8Array> {
    return this.values.get(`${jobId}:${artifactId}`) || new Uint8Array(0)
  }

  async finalize(_jobId: string, _artifactId: string, _filename: string): Promise<void> {}

  async discard(jobId: string, artifactId: string): Promise<void> {
    this.values.delete(`${jobId}:${artifactId}`)
  }
}
