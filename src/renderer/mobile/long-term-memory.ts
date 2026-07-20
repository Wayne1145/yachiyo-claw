import { v4 as uuidv4 } from 'uuid'
import { Capacitor } from '@capacitor/core'
import { encryptMobileProtectedValue, decryptMobileProtectedValue } from '@/platform/native/yachiyo_secure_storage'
import { readNativeMemoryBlob, removeNativeMemoryBlob, writeNativeMemoryBlob } from '@/platform/native/yachiyo_memory'
import platform from '@/platform'
import {
  MemoryItemSchema,
  MemoryQuerySchema,
  type MemoryItem,
  type MemoryKind,
  type MemoryQueryInput,
  type MemorySearchResult,
  type MemorySensitivity,
} from '@shared/memory'

const STORAGE_KEY = 'yachiyo-long-term-memory-v1'
const SECRET_PATTERNS = [
  /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret)\s*[:=]/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b\d{6,8}\b/,
]

export interface MemoryBlobStorage {
  getStoreBlob(key: string): Promise<string | null>
  setStoreBlob(key: string, value: string): Promise<void>
  delStoreBlob(key: string): Promise<void>
}

export interface MemoryCrypto {
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
}

export interface MemoryCandidate {
  content: string
  kind?: MemoryKind
  confidence?: number
  sensitivity?: MemorySensitivity
  tags?: string[]
  sourceSessionId?: string
  sourceMessageId?: string
  expiresAt?: number | null
}

class NativeMemoryBlobStorage implements MemoryBlobStorage {
  private readonly nativeKey: string

  constructor(private readonly fallback: MemoryBlobStorage, storageKey: string) {
    const suffix = storageKey.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 96)
    this.nativeKey = `memory:${suffix}`
  }

  async getStoreBlob(_key: string): Promise<string | null> {
    const native = await readNativeMemoryBlob(this.nativeKey)
    if (native.found && typeof native.value === 'string') return native.value
    // One-time migration of the encrypted WebView blob. Native storage remains
    // the only write target after this read succeeds.
    const legacy = await this.fallback.getStoreBlob(_key)
    if (legacy) {
      await writeNativeMemoryBlob(this.nativeKey, legacy)
      await this.fallback.delStoreBlob(_key)
    }
    return legacy
  }

  async setStoreBlob(_key: string, value: string): Promise<void> {
    await writeNativeMemoryBlob(this.nativeKey, value)
  }

  async delStoreBlob(key: string): Promise<void> {
    await removeNativeMemoryBlob(this.nativeKey)
    await this.fallback.delStoreBlob(key)
  }
}

function normalizeTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  )
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

function parseRecords(value: string | null): MemoryItem[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => MemoryItemSchema.safeParse(item))
      .filter((result): result is { success: true; data: MemoryItem } => result.success)
      .map((result) => result.data)
  } catch {
    return []
  }
}

/**
 * Local-first memory store. Android callers use the Keystore-backed crypto
 * adapter; tests and desktop callers can inject another crypto implementation.
 */
export class LongTermMemoryService {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: MemoryBlobStorage,
    private readonly crypto: MemoryCrypto,
    private readonly storageKey = STORAGE_KEY
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async read(): Promise<MemoryItem[]> {
    const envelope = await this.storage.getStoreBlob(this.storageKey)
    if (!envelope) return []
    try {
      return parseRecords(await this.crypto.decrypt(envelope))
    } catch {
      return []
    }
  }

  private async write(records: MemoryItem[]): Promise<void> {
    if (records.length === 0) {
      await this.storage.delStoreBlob(this.storageKey)
      return
    }
    const payload = JSON.stringify(records.map((record) => MemoryItemSchema.parse(record)))
    await this.storage.setStoreBlob(this.storageKey, await this.crypto.encrypt(payload))
  }

  async list(options: { includeSensitive?: boolean; now?: number } = {}): Promise<MemoryItem[]> {
    const now = options.now ?? Date.now()
    const records = await this.read()
    return records.filter(
      (record) =>
        (options.includeSensitive || record.sensitivity !== 'sensitive') &&
        (record.expiresAt === null || record.expiresAt > now)
    )
  }

  async saveCandidate(candidate: MemoryCandidate, now = Date.now()): Promise<MemoryItem | null> {
    const content = candidate.content.trim()
    if (!content || content.length > 8_000 || containsSecret(content)) return null
    const sensitivity = candidate.sensitivity ?? 'private'
    if (sensitivity === 'sensitive') return null
    const record: MemoryItem = {
      schemaVersion: 1,
      id: uuidv4(),
      kind: candidate.kind ?? 'fact',
      content,
      sourceSessionId: candidate.sourceSessionId,
      sourceMessageId: candidate.sourceMessageId,
      confidence: Math.min(1, Math.max(0, candidate.confidence ?? 0.7)),
      sensitivity,
      tags: Array.from(new Set((candidate.tags ?? []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 32),
      createdAt: now,
      updatedAt: now,
      expiresAt: candidate.expiresAt ?? null,
      userEdited: false,
    }
    return this.enqueue(async () => {
      const records = await this.read()
      const duplicate = records.find((item) => item.content.toLocaleLowerCase() === content.toLocaleLowerCase())
      if (duplicate) return duplicate
      records.push(record)
      await this.write(records)
      return record
    })
  }

  async update(id: string, patch: Partial<Pick<MemoryItem, 'content' | 'kind' | 'tags' | 'expiresAt'>>): Promise<MemoryItem | null> {
    return this.enqueue(async () => {
      const records = await this.read()
      const index = records.findIndex((item) => item.id === id)
      if (index < 0) return null
      const nextContent = patch.content?.trim() ?? records[index].content
      if (!nextContent || containsSecret(nextContent)) throw new Error('memory_content_rejected')
      const updated: MemoryItem = {
        ...records[index],
        ...patch,
        content: nextContent,
        tags: patch.tags ? Array.from(new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 32) : records[index].tags,
        updatedAt: Date.now(),
        userEdited: true,
      }
      records[index] = MemoryItemSchema.parse(updated)
      await this.write(records)
      return records[index]
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const records = await this.read()
      const next = records.filter((item) => item.id !== id)
      if (next.length === records.length) return false
      await this.write(next)
      return true
    })
  }

  async clear(): Promise<void> {
    await this.enqueue(() => this.storage.delStoreBlob(this.storageKey))
  }

  async search(input: MemoryQueryInput): Promise<MemorySearchResult[]> {
    const query = MemoryQuerySchema.parse(input)
    const queryTerms = normalizeTerms(query.query)
    const records = await this.list({ includeSensitive: query.includeSensitive, now: query.now })
    return records
      .map((item) => {
        const contentTerms = new Set(normalizeTerms(item.content))
        const matchedTerms = queryTerms.filter((term) => contentTerms.has(term))
        const lexicalScore = queryTerms.length ? matchedTerms.length / queryTerms.length : 0
        const vectorScore = query.embedding && item.embedding ? Math.max(0, cosineSimilarity(query.embedding, item.embedding)) : 0
        return { item, matchedTerms, score: Math.min(1, lexicalScore * 0.7 + vectorScore * 0.3) }
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || right.item.updatedAt - left.item.updatedAt)
      .slice(0, query.limit)
  }
}

export function createDefaultLongTermMemoryService(): LongTermMemoryService {
  const storageKey = STORAGE_KEY
  const storage: MemoryBlobStorage =
    platform.type === 'mobile' && Capacitor.isNativePlatform() ? new NativeMemoryBlobStorage(platform, storageKey) : platform
  const crypto: MemoryCrypto = {
    encrypt: async (value) => (platform.type === 'mobile' ? encryptMobileProtectedValue(value) : value),
    decrypt: async (value) => (platform.type === 'mobile' ? decryptMobileProtectedValue(value) : value),
  }
  return new LongTermMemoryService(storage, crypto, storageKey)
}

export { containsSecret as isSensitiveMemoryContent }
