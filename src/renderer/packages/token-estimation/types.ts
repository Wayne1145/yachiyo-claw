/**
 * Token Estimation System Types
 *
 * This module defines types for the token estimation computation system,
 * including task queuing, caching, and result aggregation.
 */

// ============================================================================
// Tokenizer Types
// ============================================================================

/**
 * Supported tokenizer types
 * - 'default': Standard tokenizer (tiktoken cl100k_base)
 * - 'deepseek': DeepSeek-specific tokenizer
 */
export type TokenizerType = 'default' | 'deepseek'

/**
 * Content mode for token calculation
 * - 'full': Calculate tokens for full content
 * - 'preview': Calculate tokens for preview content (first N lines)
 */
export type ContentMode = 'full' | 'preview'

/**
 * Token cache key combining tokenizer type and content mode
 * Matches TokenCacheKey from @shared/types/session
 */
export type TokenCacheKey = 'default' | 'deepseek' | 'default_preview' | 'deepseek_preview'

// ============================================================================
// Computation Task Types
// ============================================================================

/**
 * Type of computation task
 * - 'message-text': Calculate tokens for message text content
 * - 'attachment': Calculate tokens for file or link attachment
 */
export type ComputationTaskType = 'message-text' | 'attachment'

/**
 * Type of attachment
 * - 'file': MessageFile attachment
 * - 'link': MessageLink attachment
 */
export type AttachmentType = 'file' | 'link'

/**
 * A computation task for token estimation
 */
export interface ComputationTask {
  /** Unique task identifier */
  id: string
  /** Type of computation */
  type: ComputationTaskType
  /** Session ID containing the message */
  sessionId: string
  /** Message ID to compute tokens for */
  messageId: string
  /** Attachment ID (for attachment tasks) */
  attachmentId?: string
  /** Attachment type (for attachment tasks) */
  attachmentType?: AttachmentType
  /** Tokenizer to use */
  tokenizerType: TokenizerType
  /** Content mode (full or preview, for attachments) */
  contentMode?: ContentMode
  /** Task priority (lower = more urgent, 0 is highest) */
  priority: number
  /** Task creation timestamp */
  createdAt: number
}

// ============================================================================
// Task Result Types
// ============================================================================

/**
 * Result of a token computation task
 */
export interface TaskResult {
  /** Whether the computation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Whether to suppress error logging */
  silent?: boolean
  /** Computation result (if successful) */
  result?: {
    /** Type of computation */
    type: ComputationTaskType
    /** Session ID */
    sessionId: string
    /** Message ID */
    messageId: string
    /** Attachment ID (for attachment tasks) */
    attachmentId?: string
    /** Attachment type (for attachment tasks) */
    attachmentType?: AttachmentType
    /** Tokenizer used */
    tokenizerType: TokenizerType
    /** Content mode used */
    contentMode?: ContentMode
    /** Computed token count */
    tokens: number
    /** Line count (for attachments) */
    lineCount?: number
    /** Byte length (for attachments) */
    byteLength?: number
    /** Timestamp when calculation completed */
    calculatedAt: number
  }
}

// ============================================================================
// Queue State Types
// ============================================================================

/**
 * State of the computation queue
 */
export interface QueueState {
  /** Tasks waiting to be processed */
  pending: ComputationTask[]
  /** Tasks currently being processed */
  running: Map<string, ComputationTask>
  /** IDs of completed tasks */
  completed: Set<string>
}

// ============================================================================
// Hook Result Types
// ============================================================================

/**
 * Token breakdown by source
 */
export interface TokenBreakdown {
  /** Tokens from text content */
  text: number
  /** Tokens from attachments (files + links) */
  attachments: number
}

/**
 * Result returned by useTokenEstimation hook
 */
export interface TokenEstimationResult {
  /** Token count for current input (not yet sent) */
  currentInputTokens: number
  /** Token count for context messages (already in conversation) */
  contextTokens: number
  /** Total token count (currentInput + context) */
  totalTokens: number
  /** Whether any calculations are in progress */
  isCalculating: boolean
  /** Number of pending computation tasks */
  pendingTasks: number
  /** Detailed breakdown of token sources */
  breakdown: {
    /** Breakdown for current input */
    currentInput: TokenBreakdown
    /** Breakdown for context messages */
    context: TokenBreakdown
  }
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache entry for computed token values
 */
export interface TokenCacheEntry {
  /** Computed token count */
  tokens: number
  /** Timestamp when calculated */
  calculatedAt: number
  /** Content hash for validation (optional) */
  contentHash?: string
}

/**
 * Token cache map keyed by cache key
 */
export type TokenCache = Partial<Record<TokenCacheKey, TokenCacheEntry>>

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the token estimation system
 */
export interface TokenEstimationConfig {
  /** Maximum concurrent computation tasks */
  maxConcurrency: number
  /** Debounce delay for input changes (ms) */
  debounceDelay: number
  /** Number of lines for preview mode */
  previewLines: number
  /** Line count threshold for using preview mode */
  previewThreshold: number
}
