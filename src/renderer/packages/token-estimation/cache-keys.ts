/**
 * Cache Key Utilities for Token Estimation
 *
 * This module provides utilities for generating cache keys and validating
 * cached token values based on timestamps and metadata.
 */

import type { MessageFile, MessageLink, TokenCacheKey } from '@shared/types/session'
import type { ContentMode, TokenizerType } from './types'

/**
 * Get the cache key for a given tokenizer and content mode combination
 *
 * @param params.tokenizerType - The tokenizer type ('default' or 'deepseek')
 * @param params.contentMode - The content mode ('full' or 'preview')
 * @returns The corresponding cache key
 *
 * @example
 * getTokenCacheKey({ tokenizerType: 'default', contentMode: 'full' }) // 'default'
 * getTokenCacheKey({ tokenizerType: 'deepseek', contentMode: 'preview' }) // 'deepseek_preview'
 */
export function getTokenCacheKey(params: { tokenizerType: TokenizerType; contentMode: ContentMode }): TokenCacheKey {
  const { tokenizerType, contentMode } = params
  if (contentMode === 'preview') {
    return tokenizerType === 'deepseek' ? 'deepseek_preview' : 'default_preview'
  }
  return tokenizerType === 'deepseek' ? 'deepseek' : 'default'
}

/**
 * Check if message text token cache is valid
 *
 * Validation rules:
 * - No cached value → invalid (needs calculation)
 * - Has value but no calculatedAt → valid (legacy data compatibility)
 * - No messageUpdatedAt → valid (message never modified)
 * - calculatedAt >= messageUpdatedAt → valid (cache is fresh)
 * - calculatedAt < messageUpdatedAt → invalid (stale cache)
 *
 * @param tokenValue - The cached token count (undefined if not cached)
 * @param calculatedAt - Timestamp when the token was calculated (undefined for legacy data)
 * @param messageUpdatedAt - Timestamp when the message was last modified (undefined if never modified)
 * @returns true if the cache is valid, false otherwise
 *
 * @example
 * // No cached value
 * isMessageTextCacheValid(undefined, undefined, undefined) // false
 *
 * // Legacy data (has value but no timestamp)
 * isMessageTextCacheValid(100, undefined, undefined) // true
 *
 * // Fresh cache
 * isMessageTextCacheValid(100, 1000, 500) // true (calculated after update)
 *
 * // Stale cache
 * isMessageTextCacheValid(100, 500, 1000) // false (calculated before update)
 */
export function isMessageTextCacheValid(
  tokenValue: number | undefined,
  calculatedAt: number | undefined,
  messageUpdatedAt: number | undefined
): boolean {
  if (tokenValue === undefined) return false
  if (calculatedAt === undefined) return true
  if (messageUpdatedAt === undefined) return true
  return calculatedAt >= messageUpdatedAt
}

/**
 * Check if attachment token cache is valid
 *
 * Validation rules:
 * - No lineCount or byteLength → invalid (old data, needs recalculation)
 * - No tokenCountMap → invalid
 * - No cached value for the specific key → invalid
 * - Has all metadata and value → valid
 *
 * Note: Attachments are immutable (content cannot be modified, only replaced),
 * so we don't need timestamp-based validation like message text.
 *
 * @param attachment - The file or link attachment to check
 * @param cacheKey - The cache key to check for
 * @returns true if the cache is valid, false otherwise
 *
 * @example
 * // Missing lineCount
 * isAttachmentCacheValid({ byteLength: 100, tokenCountMap: { default: 50 } }, 'default') // false
 *
 * // Missing specific key
 * isAttachmentCacheValid({ lineCount: 10, byteLength: 100, tokenCountMap: { default: 50 } }, 'deepseek') // false
 *
 * // Valid cache
 * isAttachmentCacheValid({ lineCount: 10, byteLength: 100, tokenCountMap: { default: 50 } }, 'default') // true
 */
export function isAttachmentCacheValid(attachment: MessageFile | MessageLink, cacheKey: TokenCacheKey): boolean {
  if (attachment.lineCount === undefined || attachment.byteLength === undefined) {
    return false
  }
  const tokenValue = attachment.tokenCountMap?.[cacheKey]
  return tokenValue !== undefined
}
