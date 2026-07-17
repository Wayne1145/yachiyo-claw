import type { MessageFile, MessageLink } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { getTokenCacheKey, isAttachmentCacheValid, isMessageTextCacheValid } from '../cache-keys'

describe('getTokenCacheKey', () => {
  describe('full content mode', () => {
    it('returns "default" for default tokenizer with full mode', () => {
      expect(getTokenCacheKey({ tokenizerType: 'default', contentMode: 'full' })).toBe('default')
    })

    it('returns "deepseek" for deepseek tokenizer with full mode', () => {
      expect(getTokenCacheKey({ tokenizerType: 'deepseek', contentMode: 'full' })).toBe('deepseek')
    })
  })

  describe('preview content mode', () => {
    it('returns "default_preview" for default tokenizer with preview mode', () => {
      expect(getTokenCacheKey({ tokenizerType: 'default', contentMode: 'preview' })).toBe('default_preview')
    })

    it('returns "deepseek_preview" for deepseek tokenizer with preview mode', () => {
      expect(getTokenCacheKey({ tokenizerType: 'deepseek', contentMode: 'preview' })).toBe('deepseek_preview')
    })
  })
})

describe('isMessageTextCacheValid', () => {
  describe('no cached value', () => {
    it('returns false when tokenValue is undefined', () => {
      expect(isMessageTextCacheValid(undefined, undefined, undefined)).toBe(false)
      expect(isMessageTextCacheValid(undefined, 1000, undefined)).toBe(false)
      expect(isMessageTextCacheValid(undefined, 1000, 500)).toBe(false)
    })
  })

  describe('legacy data compatibility (no calculatedAt)', () => {
    it('returns true when tokenValue exists but calculatedAt is undefined', () => {
      expect(isMessageTextCacheValid(100, undefined, undefined)).toBe(true)
      expect(isMessageTextCacheValid(100, undefined, 1000)).toBe(true)
      expect(isMessageTextCacheValid(0, undefined, undefined)).toBe(true)
    })
  })

  describe('message never modified (no updatedAt)', () => {
    it('returns true when tokenValue and calculatedAt exist but updatedAt is undefined', () => {
      expect(isMessageTextCacheValid(100, 1000, undefined)).toBe(true)
      expect(isMessageTextCacheValid(0, 500, undefined)).toBe(true)
    })
  })

  describe('timestamp comparison', () => {
    it('returns true when calculatedAt >= messageUpdatedAt (fresh cache)', () => {
      expect(isMessageTextCacheValid(100, 1000, 500)).toBe(true)
      expect(isMessageTextCacheValid(100, 1000, 1000)).toBe(true)
    })

    it('returns false when calculatedAt < messageUpdatedAt (stale cache)', () => {
      expect(isMessageTextCacheValid(100, 500, 1000)).toBe(false)
      expect(isMessageTextCacheValid(100, 999, 1000)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles zero token value correctly', () => {
      expect(isMessageTextCacheValid(0, 1000, 500)).toBe(true)
      expect(isMessageTextCacheValid(0, undefined, undefined)).toBe(true)
    })

    it('handles zero timestamps correctly', () => {
      expect(isMessageTextCacheValid(100, 0, 0)).toBe(true)
      expect(isMessageTextCacheValid(100, 0, 1)).toBe(false)
    })
  })
})

describe('isAttachmentCacheValid', () => {
  const createFile = (overrides: Partial<MessageFile> = {}): MessageFile => ({
    id: 'file-1',
    name: 'test.txt',
    fileType: 'text/plain',
    ...overrides,
  })

  const createLink = (overrides: Partial<MessageLink> = {}): MessageLink => ({
    id: 'link-1',
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  })

  describe('old data detection (missing metadata)', () => {
    it('returns false when lineCount is missing', () => {
      const file = createFile({
        byteLength: 100,
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(false)
    })

    it('returns false when byteLength is missing', () => {
      const file = createFile({
        lineCount: 10,
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(false)
    })

    it('returns false when both lineCount and byteLength are missing', () => {
      const file = createFile({
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(false)
    })
  })

  describe('missing tokenCountMap', () => {
    it('returns false when tokenCountMap is undefined', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(false)
    })

    it('returns false when tokenCountMap is empty', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
        tokenCountMap: {},
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(false)
    })
  })

  describe('missing specific cache key', () => {
    it('returns false when requested key is not in tokenCountMap', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(file, 'deepseek')).toBe(false)
      expect(isAttachmentCacheValid(file, 'default_preview')).toBe(false)
      expect(isAttachmentCacheValid(file, 'deepseek_preview')).toBe(false)
    })
  })

  describe('valid cache', () => {
    it('returns true when all metadata and requested key exist', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(true)
    })

    it('returns true for all cache key types when present', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
        tokenCountMap: {
          default: 50,
          deepseek: 40,
          default_preview: 20,
          deepseek_preview: 16,
        },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(true)
      expect(isAttachmentCacheValid(file, 'deepseek')).toBe(true)
      expect(isAttachmentCacheValid(file, 'default_preview')).toBe(true)
      expect(isAttachmentCacheValid(file, 'deepseek_preview')).toBe(true)
    })

    it('handles zero token value correctly', () => {
      const file = createFile({
        lineCount: 10,
        byteLength: 100,
        tokenCountMap: { default: 0 },
      })
      expect(isAttachmentCacheValid(file, 'default')).toBe(true)
    })
  })

  describe('MessageLink support', () => {
    it('returns false for link missing metadata', () => {
      const link = createLink({
        tokenCountMap: { default: 50 },
      })
      expect(isAttachmentCacheValid(link, 'default')).toBe(false)
    })

    it('returns true for link with all metadata and value', () => {
      const link = createLink({
        lineCount: 100,
        byteLength: 5000,
        tokenCountMap: { default: 300 },
      })
      expect(isAttachmentCacheValid(link, 'default')).toBe(true)
    })
  })
})
