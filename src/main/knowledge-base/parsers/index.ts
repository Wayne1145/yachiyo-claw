import { isTextFilePath } from '../../../shared/file-extensions'
import type { DocumentParserConfig, DocumentParserType } from '../../../shared/types/settings'
import { getLogger } from '../../util'
import { ChatboxParser } from './chatbox-parser'
import { LocalParser } from './local-parser'
import { MineruParser } from './mineru-parser'
import type { DocumentParser, ParserFileMeta, ParserResult } from './types'

const log = getLogger('knowledge-base:parser-router')

export { MineruParser, testMineruConnection } from './mineru-parser'
export * from './types'

/**
 * Create a parser instance based on configuration
 * @param config - Parser configuration
 * @param kbId - Knowledge base ID (required for local parser's vision model)
 */
export function createParser(config: DocumentParserConfig, kbId?: number): DocumentParser {
  switch (config.type) {
    case 'local':
      return new LocalParser(kbId)
    case 'chatbox-ai':
      return new ChatboxParser()
    case 'mineru':
      if (!config.mineru?.apiToken) {
        throw new Error('MinerU API token is required')
      }
      return new MineruParser(config.mineru.apiToken)
    default:
      log.warn(`Unknown parser type: ${config.type}, falling back to local parser`)
      return new LocalParser(kbId)
  }
}

/**
 * Get effective parser configuration
 * Priority: KB config > Global config > Default (local)
 */
export function getEffectiveParserConfig(
  kbConfig?: DocumentParserConfig | null,
  globalConfig?: DocumentParserConfig | null
): DocumentParserConfig {
  if (kbConfig) {
    return kbConfig
  }
  if (globalConfig) {
    return globalConfig
  }
  return { type: 'local' }
}

/**
 * Parse a file using the appropriate parser
 * Text files always use local parsing for efficiency
 *
 * @param filePath - Path to the file
 * @param meta - File metadata
 * @param config - Parser configuration
 * @param kbId - Knowledge base ID (for vision model access)
 * @returns Parsed content and parser type used
 */
export async function parseFileWithRouter(
  filePath: string,
  meta: ParserFileMeta,
  config: DocumentParserConfig,
  kbId?: number
): Promise<ParserResult> {
  // 文本文件始终使用本地解析
  if (isTextFilePath(filePath)) {
    log.debug(`[ROUTER] Using local parser for text file: ${meta.filename}`)
    const localParser = new LocalParser(kbId)
    const content = await localParser.parse(filePath, meta)
    return { content, parserUsed: 'local' }
  }

  // 非文本文件使用配置的解析器
  log.debug(`[ROUTER] Using ${config.type} parser for: ${meta.filename}`)
  const parser = createParser(config, kbId)
  const content = await parser.parse(filePath, meta)
  return { content, parserUsed: config.type }
}

/**
 * Get display name for parser type
 */
export function getParserDisplayName(type: DocumentParserType): string {
  switch (type) {
    case 'local':
      return 'Local'
    case 'chatbox-ai':
      return 'Chatbox AI'
    case 'mineru':
      return 'MinerU'
    default:
      return type
  }
}
