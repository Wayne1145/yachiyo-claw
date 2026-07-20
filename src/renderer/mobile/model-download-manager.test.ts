import { describe, expect, it, vi } from 'vitest'
import type { DownloadJob, ModelArtifact } from '@shared/models/model-catalog'
import { MemoryDownloadByteStore, ModelDownloadManager, splitDownloadRange, validateDownloadArtifact } from './model-download-manager'

const bytes = new TextEncoder().encode('0123456789abcdef')
const hashPromise = crypto.subtle.digest('SHA-256', bytes).then((digest) =>
  Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
)

function artifact(hash: string): ModelArtifact {
  return {
    id: 'artifact-1',
    modelId: 'org/model',
    source: 'huggingface',
    path: 'model.gguf',
    filename: 'model.gguf',
    url: 'https://cdn.example.com/model.gguf',
    downloadUrl: 'https://cdn.example.com/model.gguf',
    revision: '0123456789abcdef0123456789abcdef01234567',
    sha256: hash,
    sizeBytes: bytes.byteLength,
    format: 'gguf',
    runtime: 'llama.cpp',
    required: true,
    companion: false,
  }
}

function jobFor(item: ModelArtifact): DownloadJob {
  return {
    id: 'job-1',
    modelId: item.modelId,
    source: item.source,
    repository: 'org/model',
    revision: item.revision,
    status: 'queued',
    artifactIds: [item.id],
    artifacts: [item],
    bytesTotal: item.sizeBytes!,
    bytesDownloaded: 0,
    maxConcurrentSegments: 4,
    segments: [{ artifactId: item.id, start: 0, end: item.sizeBytes! - 1, completedBytes: 0, status: 'pending' }],
    allowUnpinnedRevision: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('model download manager', () => {
  it('splits ranges into at most four contiguous pieces', () => {
    expect(splitDownloadRange(10, 4)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 7 },
      { start: 8, end: 9 },
    ])
  })

  it('rejects unpinned or incomplete manifests before network access', () => {
    expect(() => validateDownloadArtifact(artifact('0'.repeat(64)))).not.toThrow()
    try {
      validateDownloadArtifact({ ...artifact('0'.repeat(64)), revision: 'main' })
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'revision_unpinned' })
    }
    try {
      validateDownloadArtifact({ ...artifact('0'.repeat(64)), sha256: undefined })
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'manifest_hash_missing' })
    }
  })

  it('downloads ranged segments, resumes into a temp store, and verifies SHA-256', async () => {
    const hash = await hashPromise
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'accept-ranges': 'bytes' } })
      const range = String(init?.headers && (init.headers as Record<string, string>).Range || '')
      const match = range.match(/bytes=(\d+)-(\d+)/)
      const start = match ? Number(match[1]) : 0
      const end = match ? Number(match[2]) : bytes.length - 1
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'accept-ranges': 'bytes', etag: 'etag-1' } })
    })
    const store = new MemoryDownloadByteStore()
    const manager = new ModelDownloadManager({ store, fetchImpl: fetchImpl as typeof fetch, sleep: async () => undefined })
    const result = await manager.download(jobFor(artifact(hash)))
    expect(result.status).toBe('completed')
    expect(result.bytesDownloaded).toBe(bytes.length)
    expect(await store.read('job-1', 'artifact-1')).toEqual(bytes)
    expect(fetchImpl).toHaveBeenCalled()
  })
})
