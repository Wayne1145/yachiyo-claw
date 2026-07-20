import type {
  FileMeta,
  KnowledgeBase,
  KnowledgeBaseFile,
  KnowledgeBaseProviderMode,
  KnowledgeBaseSearchResult,
  SessionAttachment,
  SessionAttachmentParent,
  SessionAttachmentQueryPlan,
  SessionAttachmentSearchResult,
} from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import type { SessionAttachmentRagController as SessionAttachmentRagContract } from './session-attachment-rag/interface'

const INDEX_VERSION = 2
const LEGACY_STORAGE_KEY = 'yachiyo-mobile-rag-index-v1'
const MANIFEST_KEY = 'yachiyo-mobile-rag-index-v2-manifest'
const MANIFEST_BACKUP_KEY = 'yachiyo-mobile-rag-index-v2-manifest-backup'
const CHUNKS_PER_SHARD = 128

export const DEFAULT_MOBILE_RAG_LIMITS: MobileRagLimits = {
  maxKnowledgeBases: 50,
  maxDocuments: 500,
  maxDocumentBytes: 25 * 1024 * 1024,
  maxDocumentCharacters: 5_000_000,
  maxChunksPerDocument: 4_096,
  maxTotalChunks: 20_000,
  maxPersistedCharacters: 40_000_000,
  maxPersistedBytes: 96 * 1024 * 1024,
}

export interface MobileRagLimits {
  maxKnowledgeBases: number
  maxDocuments: number
  maxDocumentBytes: number
  maxDocumentCharacters: number
  maxChunksPerDocument: number
  maxTotalChunks: number
  maxPersistedCharacters: number
  maxPersistedBytes: number
}

export interface MobileRagEmbeddingProvider {
  /** The provider owns credential lookup. No credential or provider configuration is persisted in the RAG index. */
  embed(params: { texts: string[]; model?: string }): Promise<number[][]>
}

export interface MobileRagOptions {
  embeddingProvider?: MobileRagEmbeddingProvider
  defaultEmbeddingModel?: string
  limits?: Partial<MobileRagLimits>
}

export interface MobileRagScoreExplanation {
  bm25: number
  characterNgram: number
  vector: number
  phraseBonus: number
  final: number
  matchedTerms: string[]
  retrievalMode: 'lexical' | 'hybrid'
}

export type ExplainedKnowledgeBaseSearchResult = KnowledgeBaseSearchResult & { explain: MobileRagScoreExplanation }
export type ExplainedSessionAttachmentSearchResult = SessionAttachmentSearchResult & {
  explain: MobileRagScoreExplanation
}

interface MobileChunk {
  id: number
  ownerId: number
  text: string
  filename: string
  chunkIndex: number
  attachment?: boolean
  termFrequencies: Record<string, number>
  termCount: number
  characterNgrams: string[]
  embedding?: number[]
}

interface MobileRagState {
  schemaVersion: typeof INDEX_VERSION
  nextId: number
  knowledgeBases: KnowledgeBase[]
  files: KnowledgeBaseFile[]
  chunks: MobileChunk[]
  attachments: SessionAttachment[]
  parents: SessionAttachmentParent[]
}

interface PersistedMetadata extends Omit<MobileRagState, 'chunks'> {
  shardCount: number
}

interface PersistedEnvelope<T> {
  checksum: string
  payload: T
}

interface MobileRagManifest {
  schemaVersion: typeof INDEX_VERSION
  current: string
  previous?: string
  updatedAt: number
}

interface PreparedChunk {
  text: string
  termFrequencies: Record<string, number>
  termCount: number
  characterNgrams: string[]
  embedding?: number[]
}

interface RankedChunk {
  chunk: MobileChunk
  score: number
  explain: MobileRagScoreExplanation
}

interface StorageCoordinator {
  tail: Promise<void>
}

interface LoadedState {
  state: MobileRagState
  generation?: string
}

export interface MobileRagStorage {
  getStoreBlob(key: string): Promise<string | null>
  setStoreBlob(key: string, value: string): Promise<void>
  delStoreBlob(key: string): Promise<void>
  listStoreBlobKeys?(): Promise<string[]>
  readLocalFileContent?(path: string): Promise<string | null>
}

export class MobileRagCapacityError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'MobileRagCapacityError'
  }
}

const EMPTY_STATE: MobileRagState = {
  schemaVersion: INDEX_VERSION,
  nextId: 1,
  knowledgeBases: [],
  files: [],
  chunks: [],
  attachments: [],
  parents: [],
}

const coordinators = new WeakMap<object, StorageCoordinator>()

function getCoordinator(storage: MobileRagStorage): StorageCoordinator {
  let coordinator = coordinators.get(storage)
  if (!coordinator) {
    coordinator = { tail: Promise.resolve() }
    coordinators.set(storage, coordinator)
  }
  return coordinator
}

function checksum(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function encodeEnvelope<T>(payload: T): string {
  const serialized = JSON.stringify(payload)
  return JSON.stringify({ checksum: checksum(serialized), payload } satisfies PersistedEnvelope<T>)
}

function decodeEnvelope<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<PersistedEnvelope<T>>
    if (typeof envelope.checksum !== 'string' || envelope.payload === undefined) return null
    return checksum(JSON.stringify(envelope.payload)) === envelope.checksum ? envelope.payload : null
  } catch {
    return null
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .trim()
}

function selectChunkEnd(text: string, start: number, target: number): number {
  const hardEnd = Math.min(text.length, start + target)
  if (hardEnd === text.length) return hardEnd
  const minimum = start + Math.floor(target * 0.55)
  const window = text.slice(minimum, hardEnd)
  const boundaries = [
    window.lastIndexOf('\n\n'),
    Math.max(window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？')),
    Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? ')),
    Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' ')),
  ]
  const boundary = Math.max(...boundaries)
  return boundary >= 0 ? minimum + boundary + 1 : hardEnd
}

/** Paragraph/sentence aware, deterministic chunking with bounded overlap. */
export function splitMobileRagText(text: string, targetSize = 1_200, overlap = 160): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const safeTarget = Math.max(320, Math.floor(targetSize))
  const safeOverlap = Math.min(Math.max(0, Math.floor(overlap)), Math.floor(safeTarget / 3))
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length && chunks.length < DEFAULT_MOBILE_RAG_LIMITS.maxChunksPerDocument) {
    const end = selectChunkEnd(normalized, start, safeTarget)
    const chunk = normalized.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    const next = Math.max(start + 1, end - safeOverlap)
    const boundary = normalized.slice(next, Math.min(end + 1, next + safeOverlap)).search(/(?:\n\n|[。！？.!?]\s|\s)/u)
    start = boundary >= 0 ? next + boundary + 1 : next
  }
  return chunks
}

function lexicalTokens(value: string): string[] {
  const normalized = normalizeText(value).toLocaleLowerCase()
  const runs = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) ?? []
  const output: string[] = []
  for (const run of runs) {
    if (/^[\p{Script=Han}]+$/u.test(run)) {
      const characters = Array.from(run)
      output.push(...characters)
      for (let index = 0; index < characters.length - 1; index += 1)
        output.push(characters[index] + characters[index + 1])
    } else if (run.length >= 2) {
      output.push(run)
    }
  }
  return output.slice(0, 8_192)
}

function characterNgrams(value: string, limit = 256): string[] {
  const compact = normalizeText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
  const characters = Array.from(compact)
  const grams = new Set<string>()
  for (const size of [2, 3]) {
    for (let index = 0; index <= characters.length - size && grams.size < limit; index += 1) {
      grams.add(characters.slice(index, index + size).join(''))
    }
  }
  return [...grams].sort()
}

function prepareChunk(text: string): PreparedChunk {
  const tokens = lexicalTokens(text)
  const termFrequencies: Record<string, number> = Object.create(null) as Record<string, number>
  for (const token of tokens) termFrequencies[token] = (termFrequencies[token] ?? 0) + 1
  return { text, termFrequencies, termCount: tokens.length, characterNgrams: characterNgrams(text) }
}

function isFiniteEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0
}

function resolveLimits(options?: MobileRagOptions): MobileRagLimits {
  const limits = { ...DEFAULT_MOBILE_RAG_LIMITS }
  for (const key of Object.keys(limits) as Array<keyof MobileRagLimits>) {
    const candidate = options?.limits?.[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0)
      limits[key] = Math.floor(candidate)
  }
  return limits
}

async function prepareChunks(content: string, options: MobileRagOptions, model?: string): Promise<PreparedChunk[]> {
  const limits = resolveLimits(options)
  if (content.length > limits.maxDocumentCharacters) throw new MobileRagCapacityError('mobile_rag_document_too_large')
  const prepared = splitMobileRagText(content).map(prepareChunk)
  if (prepared.length > limits.maxChunksPerDocument)
    throw new MobileRagCapacityError('mobile_rag_document_has_too_many_chunks')
  if (!options.embeddingProvider || prepared.length === 0) return prepared
  let expectedDimension: number | undefined
  for (let offset = 0; offset < prepared.length; offset += 32) {
    const batch = prepared.slice(offset, offset + 32)
    try {
      const embeddings = await options.embeddingProvider.embed({ texts: batch.map((chunk) => chunk.text), model })
      if (embeddings.length !== batch.length || !embeddings.every(isFiniteEmbedding)) continue
      expectedDimension ??= embeddings[0].length
      if (!embeddings.every((embedding) => embedding.length === expectedDimension)) continue
      embeddings.forEach((embedding, index) => {
        prepared[offset + index].embedding = embedding
      })
    } catch {
      // One failed provider batch does not make the local lexical index unavailable.
    }
  }
  return prepared
}

async function embedQuery(query: string, options: MobileRagOptions, model?: string): Promise<number[] | undefined> {
  if (!options.embeddingProvider) return undefined
  try {
    const result = await options.embeddingProvider.embed({ texts: [query.slice(0, 2_048)], model })
    return result.length === 1 && isFiniteEmbedding(result[0]) ? result[0] : undefined
  } catch {
    return undefined
  }
}

function validateCapacity(state: MobileRagState, limits: MobileRagLimits): void {
  if (state.knowledgeBases.length > limits.maxKnowledgeBases)
    throw new MobileRagCapacityError('mobile_rag_too_many_knowledge_bases')
  if (state.files.length + state.attachments.length > limits.maxDocuments)
    throw new MobileRagCapacityError('mobile_rag_too_many_documents')
  if (state.chunks.length > limits.maxTotalChunks) throw new MobileRagCapacityError('mobile_rag_too_many_chunks')
  const persistedCharacters = state.chunks.reduce((total, chunk) => total + chunk.text.length, 0)
  if (persistedCharacters > limits.maxPersistedCharacters)
    throw new MobileRagCapacityError('mobile_rag_index_capacity_exceeded')
  const ownedSourceBytes = state.files
    .filter((file) => isOwnedMobileRagSource(file.filepath))
    .reduce((total, file) => total + Math.max(0, file.file_size), 0)
  if (JSON.stringify(state).length + ownedSourceBytes > limits.maxPersistedBytes)
    throw new MobileRagCapacityError('mobile_rag_persisted_index_too_large')
}

function validateDocumentInput(params: { key: string; filename: string; fileSize: number }): void {
  if (!params.key || params.key.length > 2_048 || params.key.includes('\u0000'))
    throw new Error('mobile_rag_invalid_storage_key')
  if (!params.filename.trim() || params.filename.length > 512 || params.filename.includes('\u0000'))
    throw new Error('mobile_rag_invalid_filename')
  if (!Number.isFinite(params.fileSize) || params.fileSize < 0) throw new Error('mobile_rag_invalid_file_size')
}

function hydrateChunk(value: Partial<MobileChunk>): MobileChunk | null {
  if (
    typeof value.id !== 'number' ||
    typeof value.ownerId !== 'number' ||
    typeof value.text !== 'string' ||
    typeof value.filename !== 'string' ||
    typeof value.chunkIndex !== 'number'
  )
    return null
  if (value.text.length > 2_000 || value.filename.length > 512) return null
  const prepared = prepareChunk(value.text)
  const storedFrequencies =
    value.termFrequencies && typeof value.termFrequencies === 'object' ? Object.entries(value.termFrequencies) : []
  const validStoredFrequencies =
    storedFrequencies.length <= 8_192 &&
    storedFrequencies.every(
      ([term, frequency]) =>
        term.length <= 128 && typeof frequency === 'number' && Number.isSafeInteger(frequency) && frequency > 0,
    )
  return {
    id: value.id,
    ownerId: value.ownerId,
    text: value.text,
    filename: value.filename,
    chunkIndex: value.chunkIndex,
    attachment: value.attachment === true,
    termFrequencies: validStoredFrequencies ? Object.fromEntries(storedFrequencies) : prepared.termFrequencies,
    termCount:
      typeof value.termCount === 'number' && Number.isSafeInteger(value.termCount) && value.termCount >= 0
        ? value.termCount
        : prepared.termCount,
    characterNgrams:
      Array.isArray(value.characterNgrams) &&
      value.characterNgrams.length <= 512 &&
      value.characterNgrams.every((item) => typeof item === 'string' && item.length <= 6)
        ? value.characterNgrams.slice(0, 256).sort()
        : prepared.characterNgrams,
    embedding: isFiniteEmbedding(value.embedding) ? value.embedding : undefined,
  }
}

function hasFiniteId(value: unknown): value is { id: number } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'number' &&
    Number.isSafeInteger((value as { id: number }).id) &&
    (value as { id: number }).id > 0,
  )
}

function hasStringFields(value: unknown, fields: string[]): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return fields.every((field) => typeof record[field] === 'string')
}

function hydrateState(value: unknown): MobileRagState | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<MobileRagState>
  if (
    !Array.isArray(source.knowledgeBases) ||
    !Array.isArray(source.files) ||
    !Array.isArray(source.chunks) ||
    !Array.isArray(source.attachments) ||
    !Array.isArray(source.parents)
  )
    return null
  if (
    source.knowledgeBases.length > 50 ||
    source.files.length + source.attachments.length > 500 ||
    source.parents.length > 20_000
  )
    return null
  if (
    !source.knowledgeBases.every(
      (item) => hasFiniteId(item) && hasStringFields(item, ['name', 'embeddingModel', 'rerankModel']),
    ) ||
    !source.files.every(
      (item) =>
        hasFiniteId(item) &&
        hasStringFields(item, ['filename', 'filepath', 'mime_type', 'status', 'error']) &&
        typeof item.kb_id === 'number',
    ) ||
    !source.attachments.every(
      (item) =>
        hasFiniteId(item) &&
        hasStringFields(item, [
          'sessionId',
          'messageId',
          'attachmentStorageKey',
          'filename',
          'mimeType',
          'availability',
          'indexStatus',
          'status',
        ]),
    ) ||
    !source.parents.every(
      (item) =>
        hasFiniteId(item) &&
        hasStringFields(item, ['filename', 'text']) &&
        typeof item.attachmentId === 'number' &&
        typeof item.parentOrder === 'number',
    )
  )
    return null
  const hydratedChunks = source.chunks.map((chunk) => hydrateChunk(chunk))
  if (hydratedChunks.some((chunk) => chunk === null)) return null
  const maximumId = Math.max(
    0,
    ...source.knowledgeBases.map((item) => item.id),
    ...source.files.map((item) => item.id),
    ...source.attachments.map((item) => item.id),
    ...source.parents.map((item) => item.id),
    ...hydratedChunks.map((item) => item!.id),
  )
  return {
    schemaVersion: INDEX_VERSION,
    nextId:
      typeof source.nextId === 'number' && Number.isSafeInteger(source.nextId)
        ? Math.max(maximumId + 1, 1, source.nextId)
        : maximumId + 1,
    knowledgeBases: source.knowledgeBases,
    files: source.files,
    chunks: hydratedChunks as MobileChunk[],
    attachments: source.attachments,
    parents: source.parents,
  }
}

function generationKey(generation: string, part: string): string {
  return `yachiyo-mobile-rag-index-v2-${generation}-${part}`
}

function createGeneration(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function cloneState(state: MobileRagState): MobileRagState {
  return structuredClone(state)
}

export class MobileRagIndex {
  private readonly coordinator: StorageCoordinator
  private readonly limits: MobileRagLimits

  constructor(
    private readonly storage: MobileRagStorage,
    options: MobileRagOptions = {},
  ) {
    this.coordinator = getCoordinator(storage)
    this.limits = resolveLimits(options)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.coordinator.tail.then(operation, operation)
    this.coordinator.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async readManifest(key = MANIFEST_KEY): Promise<MobileRagManifest | null> {
    const manifest = decodeEnvelope<MobileRagManifest>(await this.storage.getStoreBlob(key))
    return manifest?.schemaVersion === INDEX_VERSION && typeof manifest.current === 'string' ? manifest : null
  }

  private async readGeneration(generation: string): Promise<MobileRagState | null> {
    const metadata = decodeEnvelope<PersistedMetadata>(
      await this.storage.getStoreBlob(generationKey(generation, 'metadata')),
    )
    if (
      !metadata ||
      metadata.schemaVersion !== INDEX_VERSION ||
      !Number.isSafeInteger(metadata.shardCount) ||
      metadata.shardCount < 0 ||
      metadata.shardCount > 1_024
    )
      return null
    const chunks: MobileChunk[] = []
    for (let index = 0; index < metadata.shardCount; index += 1) {
      const shard = decodeEnvelope<MobileChunk[]>(
        await this.storage.getStoreBlob(generationKey(generation, `chunks-${index}`)),
      )
      if (!Array.isArray(shard)) return null
      const hydrated = shard.map((chunk) => hydrateChunk(chunk)).filter((chunk): chunk is MobileChunk => chunk !== null)
      if (hydrated.length !== shard.length) return null
      chunks.push(...hydrated)
    }
    return hydrateState({ ...metadata, chunks })
  }

  private async loadState(): Promise<LoadedState> {
    const manifests = [await this.readManifest(), await this.readManifest(MANIFEST_BACKUP_KEY)].filter(
      (manifest): manifest is MobileRagManifest => manifest !== null,
    )
    const attempted = new Set<string>()
    for (const manifest of manifests) {
      for (const generation of [manifest.current, manifest.previous]) {
        if (!generation || attempted.has(generation)) continue
        attempted.add(generation)
        const state = await this.readGeneration(generation)
        if (state) return { state, generation }
      }
    }
    if (this.storage.listStoreBlobKeys) {
      const generations = (await this.storage.listStoreBlobKeys())
        .map((key) => /^yachiyo-mobile-rag-index-v2-(.+)-metadata$/.exec(key)?.[1])
        .filter((generation): generation is string => Boolean(generation))
        .sort()
        .reverse()
      for (const generation of generations) {
        if (attempted.has(generation)) continue
        const state = await this.readGeneration(generation)
        if (state) return { state, generation }
      }
    }
    const legacyRaw = await this.storage.getStoreBlob(LEGACY_STORAGE_KEY)
    if (legacyRaw) {
      try {
        const migrated = hydrateState(JSON.parse(legacyRaw))
        if (migrated) {
          const generation = await this.commitState(migrated)
          await this.storage.delStoreBlob(LEGACY_STORAGE_KEY)
          return { state: migrated, generation }
        }
      } catch {
        // A corrupt legacy blob is ignored; v2 snapshots remain independently recoverable.
      }
    }
    return { state: cloneState(EMPTY_STATE) }
  }

  private async removeGeneration(generation?: string): Promise<void> {
    if (!generation) return
    if (this.storage.listStoreBlobKeys) {
      const prefix = `yachiyo-mobile-rag-index-v2-${generation}-`
      const keys = (await this.storage.listStoreBlobKeys()).filter((key) => key.startsWith(prefix))
      await Promise.all(keys.map((key) => this.storage.delStoreBlob(key)))
      return
    }
    const metadata = decodeEnvelope<PersistedMetadata>(
      await this.storage.getStoreBlob(generationKey(generation, 'metadata')),
    )
    const count = metadata && Number.isSafeInteger(metadata.shardCount) ? Math.min(metadata.shardCount, 1_024) : 0
    await Promise.all([
      this.storage.delStoreBlob(generationKey(generation, 'metadata')),
      ...Array.from({ length: count }, (_, index) =>
        this.storage.delStoreBlob(generationKey(generation, `chunks-${index}`)),
      ),
    ])
  }

  private async commitState(state: MobileRagState, knownGoodGeneration?: string): Promise<string> {
    validateCapacity(state, this.limits)
    const oldManifest = await this.readManifest()
    const generation = createGeneration()
    const shards: MobileChunk[][] = []
    for (let offset = 0; offset < state.chunks.length; offset += CHUNKS_PER_SHARD)
      shards.push(state.chunks.slice(offset, offset + CHUNKS_PER_SHARD))
    const metadata: PersistedMetadata = {
      schemaVersion: INDEX_VERSION,
      nextId: state.nextId,
      knowledgeBases: state.knowledgeBases,
      files: state.files,
      attachments: state.attachments,
      parents: state.parents,
      shardCount: shards.length,
    }
    const previous = knownGoodGeneration ?? oldManifest?.current
    try {
      await Promise.all(
        shards.map((shard, index) =>
          this.storage.setStoreBlob(generationKey(generation, `chunks-${index}`), encodeEnvelope(shard)),
        ),
      )
      await this.storage.setStoreBlob(generationKey(generation, 'metadata'), encodeEnvelope(metadata))
      if (oldManifest) await this.storage.setStoreBlob(MANIFEST_BACKUP_KEY, encodeEnvelope(oldManifest))
      // Publishing this one pointer is the commit point; readers never observe partially written generations.
      await this.storage.setStoreBlob(
        MANIFEST_KEY,
        encodeEnvelope<MobileRagManifest>({
          schemaVersion: INDEX_VERSION,
          current: generation,
          previous,
          updatedAt: Date.now(),
        }),
      )
    } catch (error) {
      await this.removeGeneration(generation).catch(() => undefined)
      throw error
    }
    const staleGenerations = new Set([oldManifest?.current, oldManifest?.previous])
    staleGenerations.delete(undefined)
    staleGenerations.delete(previous)
    void Promise.all([...staleGenerations].map((stale) => this.removeGeneration(stale))).catch(() => undefined)
    return generation
  }

  async read(): Promise<MobileRagState> {
    return this.enqueue(async () => cloneState((await this.loadState()).state))
  }

  async mutate<T>(mutation: (state: MobileRagState) => Promise<T> | T): Promise<T> {
    return this.enqueue(async () => {
      const loaded = await this.loadState()
      const result = await mutation(loaded.state)
      await this.commitState(loaded.state, loaded.generation)
      return result
    })
  }

  async write(state: MobileRagState): Promise<void> {
    await this.enqueue(() => this.commitState(cloneState(state)))
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      const manifest = await this.readManifest()
      await this.storage.delStoreBlob(MANIFEST_KEY)
      await this.storage.delStoreBlob(MANIFEST_BACKUP_KEY)
      await this.storage.delStoreBlob(LEGACY_STORAGE_KEY)
      await this.removeGeneration(manifest?.current)
      await this.removeGeneration(manifest?.previous)
    })
  }

  allocate(state: MobileRagState): number {
    const id = state.nextId
    state.nextId += 1
    return id
  }
}

function addPreparedChunks(
  index: MobileRagIndex,
  state: MobileRagState,
  ownerId: number,
  filename: string,
  prepared: PreparedChunk[],
  attachment = false,
): void {
  prepared.forEach((chunk, chunkIndex) =>
    state.chunks.push({ id: index.allocate(state), ownerId, filename, chunkIndex, attachment, ...chunk }),
  )
}

function ngramScore(queryGrams: string[], chunkGrams: string[]): number {
  if (!queryGrams.length || !chunkGrams.length) return 0
  let matches = 0
  let queryIndex = 0
  let chunkIndex = 0
  while (queryIndex < queryGrams.length && chunkIndex < chunkGrams.length) {
    const queryGram = queryGrams[queryIndex]
    const chunkGram = chunkGrams[chunkIndex]
    if (queryGram === chunkGram) {
      matches += 1
      queryIndex += 1
      chunkIndex += 1
    } else if (queryGram < chunkGram) queryIndex += 1
    else chunkIndex += 1
  }
  return matches / queryGrams.length
}

function rankChunks(chunks: MobileChunk[], query: string, queryEmbedding?: number[]): RankedChunk[] {
  if (!query.trim() || chunks.length === 0) return []
  const boundedQuery = query.slice(0, 2_048)
  const uniqueTerms = [...new Set(lexicalTokens(boundedQuery))].slice(0, 128)
  const queryGrams = characterNgrams(boundedQuery, 64)
  const averageLength = chunks.reduce((total, chunk) => total + Math.max(1, chunk.termCount), 0) / chunks.length
  const documentFrequency = new Map<string, number>()
  for (const term of uniqueTerms)
    documentFrequency.set(
      term,
      chunks.reduce((count, chunk) => count + (chunk.termFrequencies[term] ? 1 : 0), 0),
    )
  const normalizedQuery = normalizeText(boundedQuery).toLocaleLowerCase()
  return chunks
    .map((chunk) => {
      let rawBm25 = 0
      const matchedTerms: string[] = []
      for (const term of uniqueTerms) {
        const frequency = chunk.termFrequencies[term] ?? 0
        if (!frequency) continue
        matchedTerms.push(term)
        const frequencyInDocuments = documentFrequency.get(term) ?? 0
        const inverseDocumentFrequency = Math.log(
          1 + (chunks.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5),
        )
        const denominator =
          frequency + 1.2 * (1 - 0.75 + 0.75 * (Math.max(1, chunk.termCount) / Math.max(1, averageLength)))
        rawBm25 += inverseDocumentFrequency * ((frequency * 2.2) / denominator)
      }
      const bm25 = uniqueTerms.length ? 1 - Math.exp(-rawBm25 / uniqueTerms.length) : 0
      const characterNgram = ngramScore(queryGrams, chunk.characterNgrams)
      const phraseBonus =
        normalizedQuery.length >= 2 && normalizeText(chunk.text).toLocaleLowerCase().includes(normalizedQuery)
          ? 0.08
          : 0
      const hasVector = Boolean(queryEmbedding && chunk.embedding && queryEmbedding.length === chunk.embedding.length)
      const vector = hasVector ? Math.max(0, cosineSimilarity(queryEmbedding!, chunk.embedding!)) : 0
      const lexical = Math.min(1, bm25 * 0.72 + characterNgram * 0.28 + phraseBonus)
      const score = hasVector ? lexical * 0.68 + vector * 0.32 : lexical
      return {
        chunk,
        score,
        explain: {
          bm25,
          characterNgram,
          vector,
          phraseBonus,
          final: score,
          matchedTerms,
          retrievalMode: hasVector ? 'hybrid' : 'lexical',
        } satisfies MobileRagScoreExplanation,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id)
}

function overlapRatio(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0
  const rightSet = new Set(right)
  let matches = 0
  for (const value of left) if (rightSet.has(value)) matches += 1
  return matches / Math.min(left.length, right.length)
}

function deduplicateRanked(results: RankedChunk[], limit: number): RankedChunk[] {
  const selected: RankedChunk[] = []
  for (const candidate of results) {
    const duplicate = selected.some(
      (existing) =>
        normalizeText(existing.chunk.text) === normalizeText(candidate.chunk.text) ||
        overlapRatio(existing.chunk.characterNgrams, candidate.chunk.characterNgrams) >= 0.92,
    )
    if (!duplicate) selected.push(candidate)
    if (selected.length >= limit) break
  }
  return selected
}

async function readContent(storage: MobileRagStorage, key: string, localPath = false): Promise<string> {
  return (localPath ? await storage.readLocalFileContent?.(key) : null) || (await storage.getStoreBlob(key)) || ''
}

function isOwnedMobileRagSource(key: string): boolean {
  return key.startsWith('mobile-rag-source-') || key.startsWith('parseFile-')
}

export class MobileKnowledgeBaseController implements KnowledgeBaseController {
  private readonly options: MobileRagOptions
  private readonly ragIndex: MobileRagIndex

  constructor(
    private readonly storage: MobileRagStorage,
    options: MobileRagOptions = {},
  ) {
    this.options = options
    this.ragIndex = new MobileRagIndex(storage, options)
  }

  private index(): MobileRagIndex {
    return this.ragIndex
  }
  async list(): Promise<KnowledgeBase[]> {
    return (await this.index().read()).knowledgeBases
  }

  async create(createParams: {
    name: string
    embeddingModel: string
    rerankModel: string
    visionModel?: string
    documentParser?: DocumentParserConfig
    providerMode?: KnowledgeBaseProviderMode
  }): Promise<void> {
    await this.index().mutate((state) => {
      state.knowledgeBases.push({
        id: this.index().allocate(state),
        name: createParams.name.trim(),
        embeddingModel: createParams.embeddingModel,
        rerankModel: createParams.rerankModel,
        visionModel: createParams.visionModel,
        documentParser: createParams.documentParser,
        providerMode: createParams.providerMode,
        createdAt: Date.now(),
      })
    })
  }

  async delete(id: number): Promise<void> {
    const ownedSources = await this.index().mutate((state) => {
      state.knowledgeBases = state.knowledgeBases.filter((item) => item.id !== id)
      const deletedFiles = state.files.filter((file) => file.kb_id === id)
      const files = new Set(deletedFiles.map((file) => file.id))
      state.files = state.files.filter((file) => file.kb_id !== id)
      state.chunks = state.chunks.filter((chunk) => !files.has(chunk.ownerId))
      return deletedFiles.map((file) => file.filepath).filter(isOwnedMobileRagSource)
    })
    await Promise.all(ownedSources.map((key) => this.storage.delStoreBlob(key))).catch(() => undefined)
  }

  async listFiles(kbId: number): Promise<KnowledgeBaseFile[]> {
    return (await this.index().read()).files.filter((file) => file.kb_id === kbId)
  }
  async countFiles(kbId: number): Promise<number> {
    return (await this.listFiles(kbId)).length
  }
  async listFilesPaginated(kbId: number, offset = 0, limit = 20): Promise<KnowledgeBaseFile[]> {
    return (await this.listFiles(kbId)).slice(
      Math.max(0, offset),
      Math.max(0, offset) + Math.min(100, Math.max(0, limit)),
    )
  }

  async uploadFile(kbId: number, file: FileMeta): Promise<void> {
    const limits = resolveLimits(this.options)
    validateDocumentInput({ key: file.path, filename: file.name, fileSize: file.size })
    if (file.size > limits.maxDocumentBytes) throw new MobileRagCapacityError('mobile_rag_document_too_large')
    const snapshot = await this.index().read()
    const base = snapshot.knowledgeBases.find((item) => item.id === kbId)
    if (!base) throw new Error('mobile_rag_knowledge_base_not_found')
    const content = await readContent(this.storage, file.path, true)
    try {
      const prepared = await prepareChunks(content, this.options, base.embeddingModel)
      await this.index().mutate((state) => {
        if (!state.knowledgeBases.some((item) => item.id === kbId))
          throw new Error('mobile_rag_knowledge_base_not_found')
        const id = this.index().allocate(state)
        state.files.push({
          id,
          kb_id: kbId,
          filename: file.name,
          filepath: file.path,
          mime_type: file.type,
          file_size: file.size,
          chunk_count: prepared.length,
          total_chunks: prepared.length,
          status: prepared.length ? 'ready' : 'failed',
          error: prepared.length ? '' : 'file_text_unavailable',
          createdAt: Date.now(),
          parsed_remotely: 0,
        })
        addPreparedChunks(this.index(), state, id, file.name, prepared)
      })
    } catch (error) {
      if (isOwnedMobileRagSource(file.path)) await this.storage.delStoreBlob(file.path).catch(() => undefined)
      throw error
    }
  }

  async deleteFile(fileId: number): Promise<void> {
    const ownedSource = await this.index().mutate((state) => {
      const filepath = state.files.find((file) => file.id === fileId)?.filepath
      state.files = state.files.filter((file) => file.id !== fileId)
      state.chunks = state.chunks.filter((chunk) => chunk.ownerId !== fileId || chunk.attachment)
      return filepath && isOwnedMobileRagSource(filepath) ? filepath : undefined
    })
    if (ownedSource) await this.storage.delStoreBlob(ownedSource).catch(() => undefined)
  }

  async rebuildFile(fileId: number): Promise<void> {
    const snapshot = await this.index().read()
    const file = snapshot.files.find((item) => item.id === fileId)
    if (!file) return
    const base = snapshot.knowledgeBases.find((item) => item.id === file.kb_id)
    const content = await readContent(this.storage, file.filepath, true)
    const prepared = await prepareChunks(content, this.options, base?.embeddingModel)
    await this.index().mutate((state) => {
      const current = state.files.find((item) => item.id === fileId)
      if (!current) return
      state.chunks = state.chunks.filter((chunk) => chunk.ownerId !== fileId || chunk.attachment)
      addPreparedChunks(this.index(), state, fileId, current.filename, prepared)
      current.chunk_count = prepared.length
      current.total_chunks = prepared.length
      current.status = prepared.length ? 'ready' : 'failed'
      current.error = prepared.length ? '' : 'file_text_unavailable'
    })
  }

  async rebuildKnowledgeBase(kbId: number): Promise<void> {
    const fileIds = (await this.listFiles(kbId)).map((file) => file.id)
    for (const fileId of fileIds) await this.rebuildFile(fileId)
  }

  async retryFile(fileId: number): Promise<void> {
    await this.rebuildFile(fileId)
  }
  async pauseFile(fileId: number): Promise<void> {
    await this.index().mutate((state) => {
      const file = state.files.find((item) => item.id === fileId)
      if (file) file.status = 'paused'
    })
  }
  async resumeFile(fileId: number): Promise<void> {
    await this.rebuildFile(fileId)
  }

  async search(kbId: number, query: string): Promise<ExplainedKnowledgeBaseSearchResult[]> {
    const state = await this.index().read()
    const base = state.knowledgeBases.find((item) => item.id === kbId)
    const queryEmbedding = await embedQuery(query, this.options, base?.embeddingModel)
    const fileIds = new Set(
      state.files.filter((file) => file.kb_id === kbId && file.status === 'ready').map((file) => file.id),
    )
    return deduplicateRanked(
      rankChunks(
        state.chunks.filter((chunk) => !chunk.attachment && fileIds.has(chunk.ownerId)),
        query,
        queryEmbedding,
      ),
      20,
    ).map(({ chunk, score, explain }) => ({
      id: chunk.id,
      score,
      text: chunk.text,
      fileId: chunk.ownerId,
      filename: chunk.filename,
      mimeType: state.files.find((file) => file.id === chunk.ownerId)?.mime_type || 'text/plain',
      chunkIndex: chunk.chunkIndex,
      explain,
    }))
  }

  async update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }): Promise<void> {
    await this.index().mutate((state) => {
      const base = state.knowledgeBases.find((item) => item.id === updateParams.id)
      if (base) Object.assign(base, updateParams)
    })
  }
  async getFilesMeta(kbId: number, fileIds: number[]) {
    const files = await this.listFiles(kbId)
    const wanted = new Set(fileIds)
    return files
      .filter((file) => wanted.has(file.id))
      .map((file) => ({
        id: file.id,
        kbId: file.kb_id,
        filename: file.filename,
        mimeType: file.mime_type,
        fileSize: file.file_size,
        chunkCount: file.chunk_count,
        totalChunks: file.total_chunks,
        status: file.status,
        createdAt: file.createdAt,
      }))
  }
  async readFileChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
    const state = await this.index().read()
    const fileIds = new Set(state.files.filter((file) => file.kb_id === kbId).map((file) => file.id))
    const wanted = new Set(chunks.map((chunk) => `${chunk.fileId}:${chunk.chunkIndex}`))
    return state.chunks
      .filter(
        (chunk) =>
          !chunk.attachment && fileIds.has(chunk.ownerId) && wanted.has(`${chunk.ownerId}:${chunk.chunkIndex}`),
      )
      .map((chunk) => ({
        fileId: chunk.ownerId,
        filename: chunk.filename,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
      }))
  }
  async testMineruConnection(_apiToken: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'mobile_remote_parser_not_configured' }
  }
}

export class MobileSessionAttachmentRagController implements SessionAttachmentRagContract {
  private readonly options: MobileRagOptions
  private readonly ragIndex: MobileRagIndex

  constructor(
    private readonly storage: MobileRagStorage,
    options: MobileRagOptions = {},
  ) {
    this.options = options
    this.ragIndex = new MobileRagIndex(storage, options)
  }
  private index(): MobileRagIndex {
    return this.ragIndex
  }

  async create(params: {
    sessionId: string
    messageId: string
    attachmentStorageKey: string
    filename: string
    mimeType: string
    fileSize: number
    tokenEstimate: number
    parserType?: string
  }): Promise<SessionAttachment> {
    validateDocumentInput({
      key: params.attachmentStorageKey,
      filename: params.filename,
      fileSize: params.fileSize,
    })
    if (params.fileSize > resolveLimits(this.options).maxDocumentBytes)
      throw new MobileRagCapacityError('mobile_rag_document_too_large')
    const content = await readContent(this.storage, params.attachmentStorageKey)
    const prepared = await prepareChunks(content, this.options, this.options.defaultEmbeddingModel)
    const now = Date.now()
    return this.index().mutate((state) => {
      const id = this.index().allocate(state)
      const attachment: SessionAttachment = {
        id,
        sessionId: params.sessionId,
        messageId: params.messageId,
        attachmentStorageKey: params.attachmentStorageKey,
        filename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        tokenEstimate: params.tokenEstimate,
        chunkCount: prepared.length,
        totalChunks: prepared.length,
        embeddedChunks: prepared.filter((chunk) => chunk.embedding).length,
        indexingStage: 'ready',
        parserType: params.parserType,
        availability: 'allowed',
        indexStatus: prepared.length ? 'ready' : 'failed',
        status: prepared.length ? 'ready' : 'failed',
        error: prepared.length ? undefined : 'attachment_text_unavailable',
        createdAt: now,
        processingStartedAt: now,
        completedAt: now,
      }
      state.attachments.push(attachment)
      prepared.forEach((chunk, parentOrder) => {
        state.parents.push({
          id: this.index().allocate(state),
          attachmentId: id,
          filename: params.filename,
          parentOrder,
          text: chunk.text,
          tokenEstimate: Math.ceil(chunk.text.length / 4),
          charCount: chunk.text.length,
        })
      })
      addPreparedChunks(this.index(), state, id, params.filename, prepared, true)
      return attachment
    })
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> {
    const wanted = new Set(ids)
    return (await this.index().read()).attachments.filter((item) => wanted.has(item.id))
  }

  async rebuildAttachment(attachmentId: number): Promise<void> {
    const snapshot = await this.index().read()
    const attachment = snapshot.attachments.find((item) => item.id === attachmentId)
    if (!attachment) return
    const content = await readContent(this.storage, attachment.attachmentStorageKey)
    const prepared = await prepareChunks(content, this.options, this.options.defaultEmbeddingModel)
    await this.index().mutate((state) => {
      const current = state.attachments.find((item) => item.id === attachmentId)
      if (!current) return
      state.parents = state.parents.filter((parent) => parent.attachmentId !== attachmentId)
      state.chunks = state.chunks.filter((chunk) => !chunk.attachment || chunk.ownerId !== attachmentId)
      prepared.forEach((chunk, parentOrder) =>
        state.parents.push({
          id: this.index().allocate(state),
          attachmentId,
          filename: current.filename,
          parentOrder,
          text: chunk.text,
          tokenEstimate: Math.ceil(chunk.text.length / 4),
          charCount: chunk.text.length,
        }),
      )
      addPreparedChunks(this.index(), state, attachmentId, current.filename, prepared, true)
      current.chunkCount = prepared.length
      current.totalChunks = prepared.length
      current.embeddedChunks = prepared.filter((chunk) => chunk.embedding).length
      current.indexStatus = prepared.length ? 'ready' : 'failed'
      current.status = current.indexStatus
      current.indexingStage = 'ready'
      current.error = prepared.length ? undefined : 'attachment_text_unavailable'
      current.completedAt = Date.now()
    })
  }

  async retryAttachment(attachmentId: number): Promise<void> {
    await this.rebuildAttachment(attachmentId)
  }
  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> {
    await this.index().mutate((state) => {
      const item = state.attachments.find((candidate) => candidate.id === params.attachmentId)
      if (item) {
        item.sessionId = params.sessionId
        item.messageId = params.messageId
      }
    })
  }
  async deleteAttachment(attachmentId: number): Promise<void> {
    await this.index().mutate((state) => {
      state.attachments = state.attachments.filter((item) => item.id !== attachmentId)
      state.parents = state.parents.filter((item) => item.attachmentId !== attachmentId)
      state.chunks = state.chunks.filter((item) => !item.attachment || item.ownerId !== attachmentId)
    })
  }

  private async deleteMatching(predicate: (attachment: SessionAttachment) => boolean): Promise<number[]> {
    return this.index().mutate((state) => {
      const ids = state.attachments.filter(predicate).map((item) => item.id)
      const wanted = new Set(ids)
      state.attachments = state.attachments.filter((item) => !wanted.has(item.id))
      state.parents = state.parents.filter((item) => !wanted.has(item.attachmentId))
      state.chunks = state.chunks.filter((item) => !item.attachment || !wanted.has(item.ownerId))
      return ids
    })
  }

  async deleteMessageAttachments(messageId: string): Promise<number[]> {
    return this.deleteMatching((item) => item.messageId === messageId)
  }
  async deleteSessionAttachments(sessionId: string): Promise<number[]> {
    return this.deleteMatching((item) => item.sessionId === sessionId)
  }
  async cleanupOrphans(params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> {
    const sessions = new Set(params.sessionIds)
    const messages = new Set(params.messageIds)
    return this.deleteMatching((item) => !sessions.has(item.sessionId) || !messages.has(item.messageId))
  }

  async getDebugSnapshot() {
    const state = await this.index().read()
    const statusCounts = { pending: 0, indexing: 0, ready: 0, failed: 0 }
    for (const attachment of state.attachments) statusCounts[attachment.status] += 1
    const serializedSize = JSON.stringify(state).length
    return {
      dbPath: MANIFEST_KEY,
      dbSizeBytes: serializedSize,
      vectorDbPath: MANIFEST_KEY,
      vectorDbSizeBytes: state.chunks.reduce((size, chunk) => size + (chunk.embedding?.length ?? 0) * 8, 0),
      attachmentCount: state.attachments.length,
      parentCount: state.parents.length,
      chunkCount: state.chunks.filter((chunk) => chunk.attachment).length,
      vectorIndexNames: state.chunks.some((chunk) => chunk.embedding) ? ['mobile-rag-v2-cosine'] : [],
      statusCounts,
      recentAttachments: state.attachments
        .slice()
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, 20)
        .map((item) => ({
          id: item.id,
          sessionId: item.sessionId,
          messageId: item.messageId,
          filename: item.filename,
          parserType: item.parserType,
          status: item.status,
          chunkCount: item.chunkCount ?? 0,
          error: item.error,
          createdAt: item.createdAt,
          processingStartedAt: item.processingStartedAt,
          completedAt: item.completedAt,
        })),
    }
  }

  async clearAll(): Promise<number> {
    return this.index().mutate((state) => {
      const count = state.attachments.length
      state.attachments = []
      state.parents = []
      state.chunks = state.chunks.filter((chunk) => !chunk.attachment)
      return count
    })
  }

  async runMaintenance(params: { sessionIds: string[]; messageIds: string[] }) {
    const orphanDeletedIds = await this.cleanupOrphans(params)
    return { interruptedFailedCount: 0, canceledPurgedCount: 0, orphanDeletedIds }
  }

  async query(params: {
    attachmentIds: number[]
    query: string
    plan: SessionAttachmentQueryPlan
  }): Promise<ExplainedSessionAttachmentSearchResult[]> {
    const state = await this.index().read()
    const wanted = new Set(params.attachmentIds)
    const topK = Math.min(Math.max(params.plan.finalTopK || 8, 1), 50)
    const recallTopK = Math.min(Math.max(params.plan.recallTopK || topK, topK), 200)
    const queryEmbedding = await embedQuery(params.query, this.options, this.options.defaultEmbeddingModel)
    const recalled = rankChunks(
      state.chunks.filter((chunk) => chunk.attachment && wanted.has(chunk.ownerId)),
      params.query,
      queryEmbedding,
    ).slice(0, recallTopK)
    return deduplicateRanked(recalled, topK).map(({ chunk, score, explain }) => ({
      attachmentId: chunk.ownerId,
      parentId:
        state.parents.find((parent) => parent.attachmentId === chunk.ownerId && parent.parentOrder === chunk.chunkIndex)
          ?.id || chunk.id,
      filename: chunk.filename,
      chunkOrder: chunk.chunkIndex,
      text: chunk.text,
      score,
      explain,
    }))
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]> {
    const state = await this.index().read()
    const wanted = new Set(params.parentIds)
    const attachments = new Set(params.attachmentIds)
    return state.parents.filter((parent) => wanted.has(parent.id) && attachments.has(parent.attachmentId))
  }
}
