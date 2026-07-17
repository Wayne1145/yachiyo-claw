import type { DocumentParserType } from '../../../shared/types/settings'
import { parseFileRemotely } from '../remote-file-parser'
import type { DocumentParser, ParserFileMeta } from './types'

/**
 * Chatbox AI document parser
 * Uses Chatbox AI backend for cloud-based document parsing
 * Requires user to be logged in (has valid license key)
 */
export class ChatboxParser implements DocumentParser {
  readonly type: DocumentParserType = 'chatbox-ai'

  async parse(filePath: string, meta: ParserFileMeta): Promise<string> {
    // Use the existing remote file parser implementation
    return await parseFileRemotely(filePath, meta.filename, meta.mimeType)
  }
}
