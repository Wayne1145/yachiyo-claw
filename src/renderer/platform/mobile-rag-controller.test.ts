import { describe, expect, it } from 'vitest'
import {
  MobileKnowledgeBaseController,
  MobileRagCapacityError,
  MobileRagIndex,
  MobileSessionAttachmentRagController,
  splitMobileRagText,
  type MobileRagEmbeddingProvider,
  type MobileRagStorage,
} from './mobile-rag-controller'

class MemoryStorage implements MobileRagStorage {
  readonly values = new Map<string, string>()
  readonly files = new Map<string, string>()

  async getStoreBlob(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async setStoreBlob(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async delStoreBlob(key: string): Promise<void> {
    this.values.delete(key)
  }

  async listStoreBlobKeys(): Promise<string[]> {
    return [...this.values.keys()]
  }

  async readLocalFileContent(path: string): Promise<string | null> {
    return this.files.get(path) ?? null
  }
}

async function createKnowledgeBase(storage: MemoryStorage, name = 'Documents') {
  const controller = new MobileKnowledgeBaseController(storage)
  await controller.create({ name, embeddingModel: '', rerankModel: '' })
  const [base] = await controller.list()
  return { controller, base }
}

describe('mobile RAG index', () => {
  it('chunks deterministically at paragraph and sentence boundaries with overlap', () => {
    const text = `${'第一段包含稳定的中文内容。'.repeat(55)}\n\n${'Second paragraph has sentence boundaries. '.repeat(45)}`
    const first = splitMobileRagText(text, 500, 60)
    const second = splitMobileRagText(text, 500, 60)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(2)
    expect(first.every((chunk) => chunk.length <= 500)).toBe(true)
    expect(first.join('')).toContain('第一段包含稳定的中文内容')
  })

  it('uses BM25 and character n-grams for Chinese and Latin queries', async () => {
    const storage = new MemoryStorage()
    storage.files.set(
      '/phone.txt',
      '这台设备使用骁龙处理器，手机型号是测试机 Alpha。\n\nBattery health information is available here.',
    )
    storage.files.set('/travel.txt', '旅行计划包括火车和酒店，不包含任何设备资料。')
    const { controller, base } = await createKnowledgeBase(storage)
    await controller.uploadFile(base.id, { name: 'phone.txt', path: '/phone.txt', type: 'text/plain', size: 120 })
    await controller.uploadFile(base.id, { name: 'travel.txt', path: '/travel.txt', type: 'text/plain', size: 80 })

    const chinese = await controller.search(base.id, '手机处理器型号')
    const english = await controller.search(base.id, 'battery health')

    expect(chinese[0].filename).toBe('phone.txt')
    expect(chinese[0].explain.matchedTerms.length).toBeGreaterThan(0)
    expect(chinese[0].explain.retrievalMode).toBe('lexical')
    expect(english[0].filename).toBe('phone.txt')
  })

  it('bounds long-query scoring across a multi-chunk index', async () => {
    const storage = new MemoryStorage()
    const content = Array.from(
      { length: 320 },
      (_, index) => `第${index}段 ${'移动检索性能样本。'.repeat(45)} ${index === 219 ? '目标关键词' : ''}`,
    ).join('\n\n')
    storage.files.set('/many-chunks.txt', content)
    const { controller, base } = await createKnowledgeBase(storage)
    await controller.uploadFile(base.id, {
      name: 'many-chunks.txt',
      path: '/many-chunks.txt',
      type: 'text/plain',
      size: content.length,
    })

    const results = await controller.search(base.id, '目标关键词'.repeat(20_000))

    expect((await controller.listFiles(base.id))[0].chunk_count).toBeGreaterThan(100)
    expect(results.length).toBeLessThanOrEqual(20)
  })

  it('serializes read-modify-write operations shared by separate controllers', async () => {
    const storage = new MemoryStorage()
    const left = new MobileKnowledgeBaseController(storage)
    const right = new MobileKnowledgeBaseController(storage)

    await Promise.all([
      left.create({ name: 'left', embeddingModel: '', rerankModel: '' }),
      right.create({ name: 'right', embeddingModel: '', rerankModel: '' }),
    ])

    expect((await left.list()).map((base) => base.name).sort()).toEqual(['left', 'right'])
  })

  it('publishes sharded generations and falls back to the previous valid snapshot', async () => {
    const storage = new MemoryStorage()
    const controller = new MobileKnowledgeBaseController(storage)
    await controller.create({ name: 'first', embeddingModel: '', rerankModel: '' })
    await controller.create({ name: 'second', embeddingModel: '', rerankModel: '' })

    const manifestKey = [...storage.values.keys()].find((key) => key.endsWith('v2-manifest'))!
    const manifest = JSON.parse(storage.values.get(manifestKey)!) as { payload: { current: string; previous: string } }
    const currentMetadata = [...storage.values.keys()].find(
      (key) => key.includes(manifest.payload.current) && key.endsWith('-metadata'),
    )!
    storage.values.set(currentMetadata, '{"checksum":"broken","payload":{}}')

    const recovered = await new MobileRagIndex(storage).read()
    expect(recovered.knowledgeBases.map((base) => base.name)).toEqual(['first'])

    await controller.create({ name: 'after-recovery', embeddingModel: '', rerankModel: '' })
    const repairedManifest = JSON.parse(storage.values.get(manifestKey)!) as { payload: { current: string } }
    const repairedMetadata = [...storage.values.keys()].find(
      (key) => key.includes(repairedManifest.payload.current) && key.endsWith('-metadata'),
    )!
    storage.values.set(repairedMetadata, '{"checksum":"broken-again","payload":{}}')
    expect((await new MobileRagIndex(storage).read()).knowledgeBases.map((base) => base.name)).toEqual(['first'])
    expect(storage.values.has('yachiyo-mobile-rag-index-v1')).toBe(false)
  })

  it('migrates a valid legacy blob without discarding documents', async () => {
    const storage = new MemoryStorage()
    storage.values.set(
      'yachiyo-mobile-rag-index-v1',
      JSON.stringify({
        nextId: 4,
        knowledgeBases: [{ id: 1, name: 'legacy', embeddingModel: '', rerankModel: '', createdAt: 1 }],
        files: [],
        chunks: [],
        attachments: [],
        parents: [],
      }),
    )

    const state = await new MobileRagIndex(storage).read()
    expect(state.knowledgeBases[0].name).toBe('legacy')
    expect(storage.values.has('yachiyo-mobile-rag-index-v1')).toBe(false)
    expect([...storage.values.keys()].some((key) => key.endsWith('v2-manifest'))).toBe(true)
  })

  it('recovers a generation when the primary manifest is corrupt', async () => {
    const storage = new MemoryStorage()
    const controller = new MobileKnowledgeBaseController(storage)
    await controller.create({ name: 'recoverable', embeddingModel: '', rerankModel: '' })
    const manifestKey = [...storage.values.keys()].find((key) => key.endsWith('v2-manifest'))!
    storage.values.set(manifestKey, '{"checksum":"bad","payload":{}}')

    expect((await new MobileRagIndex(storage).read()).knowledgeBases[0].name).toBe('recoverable')
  })

  it('fuses optional embeddings without persisting provider credentials', async () => {
    const storage = new MemoryStorage()
    storage.files.set('/semantic.txt', 'A passage whose words do not overlap the lookup phrase.')
    const provider: MobileRagEmbeddingProvider = {
      embed: async ({ texts }) => texts.map((text) => (text.includes('lookup') ? [0, 1] : [0, 1])),
    }
    const controller = new MobileKnowledgeBaseController(storage, { embeddingProvider: provider })
    await controller.create({ name: 'hybrid', embeddingModel: 'test-embedding', rerankModel: '' })
    const [base] = await controller.list()
    await controller.uploadFile(base.id, { name: 'semantic.txt', path: '/semantic.txt', type: 'text/plain', size: 80 })

    const results = await controller.search(base.id, 'completely unrelated lookup')
    expect(results[0].explain.retrievalMode).toBe('hybrid')
    expect(results[0].explain.vector).toBe(1)
    expect([...storage.values.values()].join('\n')).not.toContain('apiKey')
  })

  it('rebuilds one changed file without replacing other indexed documents', async () => {
    const storage = new MemoryStorage()
    storage.files.set('/one.txt', 'old unique phrase')
    storage.files.set('/two.txt', 'persistent second document')
    const { controller, base } = await createKnowledgeBase(storage)
    await controller.uploadFile(base.id, { name: 'one.txt', path: '/one.txt', type: 'text/plain', size: 20 })
    await controller.uploadFile(base.id, { name: 'two.txt', path: '/two.txt', type: 'text/plain', size: 30 })
    const [first] = await controller.listFiles(base.id)
    storage.files.set('/one.txt', 'replacement searchable phrase')

    await controller.retryFile(first.id)

    expect((await controller.search(base.id, 'replacement'))[0].filename).toBe('one.txt')
    expect((await controller.search(base.id, 'persistent'))[0].filename).toBe('two.txt')
    expect(await controller.search(base.id, 'old unique')).toEqual([])
  })

  it('enforces document and corpus capacity before publishing a mutation', async () => {
    const storage = new MemoryStorage()
    const sourceKey = 'mobile-rag-source-capacity-test'
    storage.files.set(sourceKey, 'x'.repeat(101))
    storage.values.set(sourceKey, 'x'.repeat(101))
    const controller = new MobileKnowledgeBaseController(storage, { limits: { maxDocumentCharacters: 100 } })
    await controller.create({ name: 'limited', embeddingModel: '', rerankModel: '' })
    const [base] = await controller.list()

    await expect(
      controller.uploadFile(base.id, { name: 'large.txt', path: sourceKey, type: 'text/plain', size: 101 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MobileRagCapacityError>>({ code: 'mobile_rag_document_too_large' }),
    )
    expect(await controller.countFiles(base.id)).toBe(0)
    expect(storage.values.has(sourceKey)).toBe(false)
  })

  it('removes owned source blobs when an indexed file is deleted', async () => {
    const storage = new MemoryStorage()
    const sourceKey = 'mobile-rag-source-delete-test'
    storage.files.set(sourceKey, 'owned source content')
    storage.values.set(sourceKey, 'owned source content')
    const { controller, base } = await createKnowledgeBase(storage)
    await controller.uploadFile(base.id, { name: 'owned.txt', path: sourceKey, type: 'text/plain', size: 20 })
    const [file] = await controller.listFiles(base.id)

    await controller.deleteFile(file.id)

    expect(storage.values.has(sourceKey)).toBe(false)
  })
})

describe('mobile session attachment RAG', () => {
  it('deduplicates overlapping results and exposes score explanations', async () => {
    const storage = new MemoryStorage()
    storage.values.set('attachment:text', `${'重复的检索内容以及目标关键词。'.repeat(100)}\n\n最后一段。`)
    const controller = new MobileSessionAttachmentRagController(storage)
    const attachment = await controller.create({
      sessionId: 'session',
      messageId: 'message',
      attachmentStorageKey: 'attachment:text',
      filename: 'repeat.txt',
      mimeType: 'text/plain',
      fileSize: 2_000,
      tokenEstimate: 500,
    })

    const results = await controller.query({
      attachmentIds: [attachment.id],
      query: '目标关键词',
      plan: { recallTopK: 20, finalTopK: 10 },
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThan(10)
    expect(results[0].explain.characterNgram).toBeGreaterThan(0)
  })

  it('clears attachment records without deleting knowledge base data', async () => {
    const storage = new MemoryStorage()
    storage.values.set('attachment:text', 'attachment content')
    const knowledge = new MobileKnowledgeBaseController(storage)
    const attachments = new MobileSessionAttachmentRagController(storage)
    await knowledge.create({ name: 'keep', embeddingModel: '', rerankModel: '' })
    await attachments.create({
      sessionId: 'session',
      messageId: 'message',
      attachmentStorageKey: 'attachment:text',
      filename: 'a.txt',
      mimeType: 'text/plain',
      fileSize: 20,
      tokenEstimate: 5,
    })

    expect(await attachments.clearAll()).toBe(1)
    expect((await knowledge.list()).map((base) => base.name)).toEqual(['keep'])
  })

  it('removes orphan attachments in one atomic mutation', async () => {
    const storage = new MemoryStorage()
    storage.values.set('one', 'first attachment')
    storage.values.set('two', 'second attachment')
    const controller = new MobileSessionAttachmentRagController(storage)
    const keep = await controller.create({
      sessionId: 's1',
      messageId: 'm1',
      attachmentStorageKey: 'one',
      filename: 'one.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      tokenEstimate: 3,
    })
    const remove = await controller.create({
      sessionId: 's2',
      messageId: 'm2',
      attachmentStorageKey: 'two',
      filename: 'two.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      tokenEstimate: 3,
    })

    expect(await controller.cleanupOrphans({ sessionIds: ['s1'], messageIds: ['m1'] })).toEqual([remove.id])
    expect((await controller.getAttachments([keep.id, remove.id])).map((item) => item.id)).toEqual([keep.id])
  })
})
