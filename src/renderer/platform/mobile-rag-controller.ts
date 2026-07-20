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

interface MobileChunk {
  id: number
  ownerId: number
  text: string
  filename: string
  chunkIndex: number
  attachment?: boolean
}

interface MobileRagState {
  nextId: number
  knowledgeBases: KnowledgeBase[]
  files: KnowledgeBaseFile[]
  chunks: MobileChunk[]
  attachments: SessionAttachment[]
  parents: SessionAttachmentParent[]
}

export interface MobileRagStorage {
  getStoreBlob(key: string): Promise<string | null>
  setStoreBlob(key: string, value: string): Promise<void>
  delStoreBlob(key: string): Promise<void>
  readLocalFileContent?(path: string): Promise<string | null>
}

const STORAGE_KEY = 'yachiyo-mobile-rag-index-v1'
const EMPTY_STATE: MobileRagState = { nextId: 1, knowledgeBases: [], files: [], chunks: [], attachments: [], parents: [] }

function splitText(text: string, chunkSize = 1_200): string[] {
  const normalized = text.replace(/\u0000/g, '').trim()
  if (!normalized) return []
  const chunks: string[] = []
  for (let offset = 0; offset < normalized.length; offset += chunkSize - 120) {
    const chunk = normalized.slice(offset, offset + chunkSize).trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks.slice(0, 4_096)
}

function terms(value: string): string[] {
  return value.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2)
}

function lexicalScore(query: string, text: string): number {
  const queryTerms = new Set(terms(query))
  if (!queryTerms.size) return 0
  const textTerms = new Set(terms(text))
  let matches = 0
  for (const term of queryTerms) if (textTerms.has(term)) matches += 1
  return matches / queryTerms.size
}

export class MobileRagIndex {
  private mutation: Promise<void> = Promise.resolve()

  constructor(private readonly storage: MobileRagStorage) {}

  async read(): Promise<MobileRagState> {
    const raw = await this.storage.getStoreBlob(STORAGE_KEY)
    if (!raw) return structuredClone(EMPTY_STATE)
    try {
      const parsed = JSON.parse(raw) as Partial<MobileRagState>
      return {
        nextId: typeof parsed.nextId === 'number' ? parsed.nextId : 1,
        knowledgeBases: Array.isArray(parsed.knowledgeBases) ? parsed.knowledgeBases : [],
        files: Array.isArray(parsed.files) ? parsed.files : [],
        chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
        attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
        parents: Array.isArray(parsed.parents) ? parsed.parents : [],
      }
    } catch {
      return structuredClone(EMPTY_STATE)
    }
  }

  async write(state: MobileRagState): Promise<void> {
    const run = this.mutation.then(async () => this.storage.setStoreBlob(STORAGE_KEY, JSON.stringify(state)), async () => this.storage.setStoreBlob(STORAGE_KEY, JSON.stringify(state)))
    this.mutation = run.then(() => undefined, () => undefined)
    await run
  }

  async clear(): Promise<void> {
    await this.storage.delStoreBlob(STORAGE_KEY)
  }

  allocate(state: MobileRagState): number {
    const id = state.nextId
    state.nextId += 1
    return id
  }
}

export class MobileKnowledgeBaseController implements KnowledgeBaseController {
  constructor(private readonly storage: MobileRagStorage) {}

  private index(): MobileRagIndex {
    return new MobileRagIndex(this.storage)
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
    const index = this.index()
    const state = await index.read()
    state.knowledgeBases.push({ id: index.allocate(state), name: createParams.name.trim(), embeddingModel: createParams.embeddingModel, rerankModel: createParams.rerankModel, visionModel: createParams.visionModel, documentParser: createParams.documentParser, providerMode: createParams.providerMode, createdAt: Date.now() })
    await index.write(state)
  }

  async delete(id: number): Promise<void> {
    const index = this.index()
    const state = await index.read()
    state.knowledgeBases = state.knowledgeBases.filter((item) => item.id !== id)
    const files = new Set(state.files.filter((file) => file.kb_id === id).map((file) => file.id))
    state.files = state.files.filter((file) => file.kb_id !== id)
    state.chunks = state.chunks.filter((chunk) => !files.has(chunk.ownerId))
    await index.write(state)
  }

  async listFiles(kbId: number): Promise<KnowledgeBaseFile[]> {
    return (await this.index().read()).files.filter((file) => file.kb_id === kbId)
  }

  async countFiles(kbId: number): Promise<number> {
    return (await this.listFiles(kbId)).length
  }

  async listFilesPaginated(kbId: number, offset = 0, limit = 20): Promise<KnowledgeBaseFile[]> {
    return (await this.listFiles(kbId)).slice(Math.max(0, offset), Math.max(0, offset) + Math.min(100, limit))
  }

  async uploadFile(kbId: number, file: FileMeta): Promise<void> {
    const index = this.index()
    const state = await index.read()
    const id = index.allocate(state)
    const content = (await this.storage.readLocalFileContent?.(file.path)) || (await this.storage.getStoreBlob(file.path)) || ''
    const chunks = splitText(content)
    const record: KnowledgeBaseFile = { id, kb_id: kbId, filename: file.name, filepath: file.path, mime_type: file.type, file_size: file.size, chunk_count: chunks.length, total_chunks: chunks.length, status: chunks.length ? 'ready' : 'failed', error: chunks.length ? '' : 'file_text_unavailable', createdAt: Date.now(), parsed_remotely: 0 }
    state.files.push(record)
    chunks.forEach((text, chunkIndex) => state.chunks.push({ id: index.allocate(state), ownerId: id, text, filename: file.name, chunkIndex }))
    await index.write(state)
  }

  async deleteFile(fileId: number): Promise<void> {
    const index = this.index()
    const state = await index.read()
    state.files = state.files.filter((file) => file.id !== fileId)
    state.chunks = state.chunks.filter((chunk) => chunk.ownerId !== fileId)
    await index.write(state)
  }

  async retryFile(fileId: number): Promise<void> {
    const index = this.index()
    const state = await index.read()
    const file = state.files.find((item) => item.id === fileId)
    if (file) file.status = state.chunks.some((chunk) => chunk.ownerId === fileId) ? 'ready' : 'failed'
    await index.write(state)
  }

  async pauseFile(fileId: number): Promise<void> {
    const index = this.index(); const state = await index.read(); const file = state.files.find((item) => item.id === fileId); if (file) file.status = 'paused'; await index.write(state)
  }

  async resumeFile(fileId: number): Promise<void> {
    return this.retryFile(fileId)
  }

  async search(kbId: number, query: string): Promise<KnowledgeBaseSearchResult[]> {
    const state = await this.index().read()
    const fileIds = new Set(state.files.filter((file) => file.kb_id === kbId).map((file) => file.id))
    return state.chunks
      .filter((chunk) => fileIds.has(chunk.ownerId))
      .map((chunk) => ({ chunk, score: lexicalScore(query, chunk.text) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map(({ chunk, score }) => ({ id: chunk.id, score, text: chunk.text, fileId: chunk.ownerId, filename: chunk.filename, mimeType: state.files.find((file) => file.id === chunk.ownerId)?.mime_type || 'text/plain', chunkIndex: chunk.chunkIndex }))
  }

  async update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }): Promise<void> {
    const index = this.index(); const state = await index.read(); const base = state.knowledgeBases.find((item) => item.id === updateParams.id); if (!base) return; Object.assign(base, updateParams); await index.write(state)
  }

  async getFilesMeta(kbId: number, fileIds: number[]) {
    const files = await this.listFiles(kbId); const wanted = new Set(fileIds)
    return files.filter((file) => wanted.has(file.id)).map((file) => ({ id: file.id, kbId: file.kb_id, filename: file.filename, mimeType: file.mime_type, fileSize: file.file_size, chunkCount: file.chunk_count, totalChunks: file.total_chunks, status: file.status, createdAt: file.createdAt }))
  }

  async readFileChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
    const state = await this.index().read(); const fileIds = new Set(state.files.filter((file) => file.kb_id === kbId).map((file) => file.id)); const wanted = new Set(chunks.map((chunk) => `${chunk.fileId}:${chunk.chunkIndex}`))
    return state.chunks.filter((chunk) => fileIds.has(chunk.ownerId) && wanted.has(`${chunk.ownerId}:${chunk.chunkIndex}`)).map((chunk) => ({ fileId: chunk.ownerId, filename: chunk.filename, chunkIndex: chunk.chunkIndex, text: chunk.text }))
  }

  async testMineruConnection(_apiToken: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'mobile_remote_parser_not_configured' }
  }
}

export class MobileSessionAttachmentRagController implements SessionAttachmentRagContract {
  constructor(private readonly storage: MobileRagStorage) {}
  private index(): MobileRagIndex { return new MobileRagIndex(this.storage) }

  async create(params: { sessionId: string; messageId: string; attachmentStorageKey: string; filename: string; mimeType: string; fileSize: number; tokenEstimate: number; parserType?: string }): Promise<SessionAttachment> {
    const index = this.index(); const state = await index.read(); const id = index.allocate(state); const content = (await this.storage.getStoreBlob(params.attachmentStorageKey)) || ''; const chunks = splitText(content); const now = Date.now()
    const attachment: SessionAttachment = { id, sessionId: params.sessionId, messageId: params.messageId, attachmentStorageKey: params.attachmentStorageKey, filename: params.filename, mimeType: params.mimeType, fileSize: params.fileSize, tokenEstimate: params.tokenEstimate, chunkCount: chunks.length, totalChunks: chunks.length, embeddedChunks: chunks.length, indexingStage: 'ready', parserType: params.parserType, availability: 'allowed', indexStatus: chunks.length ? 'ready' : 'failed', status: chunks.length ? 'ready' : 'failed', error: chunks.length ? undefined : 'attachment_text_unavailable', createdAt: now, completedAt: now }
    state.attachments.push(attachment)
    chunks.forEach((text, parentOrder) => { const parentId = index.allocate(state); state.parents.push({ id: parentId, attachmentId: id, filename: params.filename, parentOrder, text, tokenEstimate: Math.ceil(text.length / 4), charCount: text.length }); state.chunks.push({ id: index.allocate(state), ownerId: id, text, filename: params.filename, chunkIndex: parentOrder, attachment: true }) })
    await index.write(state); return attachment
  }

  async getAttachments(ids: number[]): Promise<SessionAttachment[]> { const wanted = new Set(ids); return (await this.index().read()).attachments.filter((item) => wanted.has(item.id)) }
  async retryAttachment(attachmentId: number): Promise<void> { const index = this.index(); const state = await index.read(); const item = state.attachments.find((candidate) => candidate.id === attachmentId); if (item) { item.indexStatus = state.parents.some((parent) => parent.attachmentId === attachmentId) ? 'ready' : 'failed'; item.status = item.indexStatus; } await index.write(state) }
  async rebindAttachment(params: { attachmentId: number; sessionId: string; messageId: string }): Promise<void> { const index = this.index(); const state = await index.read(); const item = state.attachments.find((candidate) => candidate.id === params.attachmentId); if (item) { item.sessionId = params.sessionId; item.messageId = params.messageId } await index.write(state) }
  async deleteAttachment(attachmentId: number): Promise<void> { const index = this.index(); const state = await index.read(); state.attachments = state.attachments.filter((item) => item.id !== attachmentId); state.parents = state.parents.filter((item) => item.attachmentId !== attachmentId); state.chunks = state.chunks.filter((item) => !item.attachment || item.ownerId !== attachmentId); await index.write(state) }
  async deleteMessageAttachments(messageId: string): Promise<number[]> { const items = (await this.index().read()).attachments.filter((item) => item.messageId === messageId); await Promise.all(items.map((item) => this.deleteAttachment(item.id))); return items.map((item) => item.id) }
  async deleteSessionAttachments(sessionId: string): Promise<number[]> { const items = (await this.index().read()).attachments.filter((item) => item.sessionId === sessionId); await Promise.all(items.map((item) => this.deleteAttachment(item.id))); return items.map((item) => item.id) }
  async cleanupOrphans(_params: { sessionIds: string[]; messageIds: string[] }): Promise<number[]> { return [] }
  async getDebugSnapshot() { const state = await this.index().read(); return { attachments: state.attachments, parents: state.parents, chunks: state.chunks.filter((chunk) => chunk.attachment), generatedAt: Date.now() } as any }
  async clearAll(): Promise<number> { const state = await this.index().read(); const count = state.attachments.length; await this.index().clear(); return count }
  async runMaintenance(_params: { sessionIds: string[]; messageIds: string[] }) { return { deletedAttachmentIds: [], retriedAttachmentIds: [], remainingAttachmentIds: (await this.index().read()).attachments.map((item) => item.id) } as any }

  async query(params: { attachmentIds: number[]; query: string; plan: SessionAttachmentQueryPlan }): Promise<SessionAttachmentSearchResult[]> {
    const state = await this.index().read(); const wanted = new Set(params.attachmentIds); const topK = Math.min(Math.max(params.plan.finalTopK || 8, 1), 50)
    return state.chunks.filter((chunk) => chunk.attachment && wanted.has(chunk.ownerId)).map((chunk) => ({ chunk, score: lexicalScore(params.query, chunk.text) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, topK).map(({ chunk, score }) => ({ attachmentId: chunk.ownerId, parentId: state.parents.find((parent) => parent.attachmentId === chunk.ownerId && parent.parentOrder === chunk.chunkIndex)?.id || chunk.id, filename: chunk.filename, chunkOrder: chunk.chunkIndex, text: chunk.text, score }))
  }

  async readParents(params: { parentIds: number[]; attachmentIds: number[] }): Promise<SessionAttachmentParent[]> { const state = await this.index().read(); const wanted = new Set(params.parentIds); const attachments = new Set(params.attachmentIds); return state.parents.filter((parent) => wanted.has(parent.id) && attachments.has(parent.attachmentId)) }
}
