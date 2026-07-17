import type { DocumentParserType } from '../../../shared/types/settings'

/**
 * File metadata for parsing
 */
export interface ParserFileMeta {
  fileId: number
  filename: string
  mimeType: string
}

/**
 * 策略模式统一解析器接口
 */
export interface DocumentParser {
  readonly type: DocumentParserType

  /**
   * Parse a file and return its text content
   * @param filePath - Path to the file to parse
   * @param meta - File metadata
   * @returns Parsed text content
   */
  parse(filePath: string, meta: ParserFileMeta): Promise<string>
}

/**
 * Parser result with metadata about the parsing process
 */
export interface ParserResult {
  content: string
  parserUsed: DocumentParserType
}

/**
 * MinerU-specific error codes
 */
export type MineruErrorCode =
  | 'AUTH_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'PARSE_FAILED'
  | 'NETWORK_ERROR'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'CANCELLED'

/**
 * MinerU API error class
 */
export class MineruError extends Error {
  constructor(
    message: string,
    public code: MineruErrorCode
  ) {
    super(message)
    this.name = 'MineruError'
  }
}

/**
 * MinerU batch upload API response types
 */
export interface MineruBatchUploadResponse {
  code: number
  msg: string
  data: {
    batch_id: string
    file_urls: string[]
  }
}

export interface MineruExtractResult {
  file_name: string
  data_id?: string
  state: 'waiting-file' | 'pending' | 'running' | 'done' | 'failed' | 'converting'
  full_zip_url?: string
  err_msg?: string
  extract_progress?: {
    extracted_pages: number
    total_pages: number
    start_time: string
  }
}

export interface MineruBatchResultResponse {
  code: number
  msg: string
  data: {
    batch_id: string
    extract_result: MineruExtractResult[]
  }
}
