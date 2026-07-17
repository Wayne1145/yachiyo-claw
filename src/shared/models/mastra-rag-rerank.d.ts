// Type declarations for @mastra/rag/dist/rerank (subpath not exported in package.json)
declare module '@mastra/rag/dist/rerank' {
  import type { QueryResult } from '@mastra/core/vector'

  interface WeightConfig {
    semantic?: number
    vector?: number
    position?: number
  }

  interface ScoringDetails {
    semantic: number
    vector: number
    position: number
    queryAnalysis?: {
      magnitude: number
      dominantFeatures: number[]
    }
  }

  export interface RerankResult {
    result: QueryResult
    score: number
    details: ScoringDetails
  }

  export interface RerankerFunctionOptions {
    weights?: WeightConfig
    queryEmbedding?: number[]
    topK?: number
  }
}
