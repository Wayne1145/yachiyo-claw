import type {
  FileMeta,
  KnowledgeBase,
  KnowledgeBaseFile,
  KnowledgeBaseProviderMode,
  KnowledgeBaseSearchResult,
} from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'

export interface KnowledgeBaseController {
  list(): Promise<KnowledgeBase[]>
  create(createParams: {
    name: string
    embeddingModel: string
    rerankModel: string
    visionModel?: string
    documentParser?: DocumentParserConfig
    providerMode?: KnowledgeBaseProviderMode
  }): Promise<void>
  delete(id: number): Promise<void>
  listFiles(kbId: number): Promise<KnowledgeBaseFile[]>
  countFiles(kbId: number): Promise<number>
  listFilesPaginated(kbId: number, offset?: number, limit?: number): Promise<KnowledgeBaseFile[]>
  uploadFile(kbId: number, file: FileMeta): Promise<void>
  deleteFile(fileId: number): Promise<void>
  retryFile(fileId: number, useRemoteParsing?: boolean): Promise<void>
  pauseFile(fileId: number): Promise<void>
  resumeFile(fileId: number): Promise<void>
  search(kbId: number, query: string): Promise<KnowledgeBaseSearchResult[]>
  update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }): Promise<void>
  getFilesMeta(
    kbId: number,
    fileIds: number[]
  ): Promise<
    {
      id: number
      kbId: number
      filename: string
      mimeType: string
      fileSize: number
      chunkCount: number
      totalChunks: number
      status: string
      createdAt: number
    }[]
  >
  readFileChunks(
    kbId: number,
    chunks: { fileId: number; chunkIndex: number }[]
  ): Promise<{ fileId: number; filename: string; chunkIndex: number; text: string }[]>
  testMineruConnection(apiToken: string): Promise<{ success: boolean; error?: string }>
}
