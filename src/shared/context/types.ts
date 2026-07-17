/**
 * Shared types for context building
 * Platform abstraction for attachment handling
 */

import type { CompactionPoint } from '@shared/types'

/**
 * Platform abstraction for reading attachments
 * Implemented by renderer platform layer, used by shared context builder
 */
export interface AttachmentResolver {
  /**
   * Read attachment content as string
   * @param attachmentId - The attachment identifier
   * @returns Attachment content or null if not found
   */
  read(attachmentId: string): Promise<string | null>
}

/**
 * Options for context building
 */
export interface ContextBuilderOptions {
  /**
   * Resolver for accessing attachments
   */
  attachmentResolver: AttachmentResolver

  /**
   * Maximum number of messages to include in context (optional)
   * When set, limits the context to the most recent N messages
   */
  maxContextMessageCount?: number

  /**
   * Compaction points for history compression (optional)
   * When provided, context starts from the latest compaction point
   */
  compactionPoints?: CompactionPoint[]

  /**
   * Number of recent tool call rounds to keep intact (optional)
   * Older tool calls are cleaned up to reduce context size
   * Default: 2
   */
  keepToolCallRounds?: number

  /**
   * Whether the model supports tool use for file reading (optional)
   * When true, large files are truncated with instructions to use tools
   * Default: false
   */
  modelSupportToolUseForFile?: boolean
}
