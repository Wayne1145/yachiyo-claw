import { describe, expect, it } from 'vitest'
import { MemoryItemSchema, MemoryQuerySchema } from './types'

const item = {
  schemaVersion: 1,
  id: 'memory-1',
  kind: 'preference',
  content: 'The user prefers concise answers.',
  confidence: 0.9,
  sensitivity: 'private',
  tags: ['response-style'],
  createdAt: 100,
  updatedAt: 100,
  expiresAt: null,
  userEdited: false,
} as const

describe('long-term memory contracts', () => {
  it('accepts bounded structured memories and applies safe query defaults', () => {
    expect(MemoryItemSchema.parse(item)).toEqual(item)
    expect(MemoryQuerySchema.parse({ query: 'response style' })).toMatchObject({
      limit: 8,
      includeSensitive: false,
    })
  })

  it('rejects unknown fields and out-of-range confidence values', () => {
    expect(MemoryItemSchema.safeParse({ ...item, rawSecret: 'nope' }).success).toBe(false)
    expect(MemoryItemSchema.safeParse({ ...item, confidence: 1.1 }).success).toBe(false)
  })
})
