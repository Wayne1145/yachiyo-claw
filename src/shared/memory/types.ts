import { z } from 'zod'

export const MemoryKindSchema = z.enum(['fact', 'preference', 'goal', 'note'])
export type MemoryKind = z.infer<typeof MemoryKindSchema>

export const MemorySensitivitySchema = z.enum(['public', 'private', 'sensitive'])
export type MemorySensitivity = z.infer<typeof MemorySensitivitySchema>

export const MemoryItemSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(128),
    kind: MemoryKindSchema,
    content: z.string().trim().min(1).max(8_000),
    sourceSessionId: z.string().trim().min(1).max(256).optional(),
    sourceMessageId: z.string().trim().min(1).max(256).optional(),
    confidence: z.number().min(0).max(1),
    sensitivity: MemorySensitivitySchema,
    tags: z.array(z.string().trim().min(1).max(64)).max(32),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive().nullable(),
    userEdited: z.boolean(),
    embedding: z.array(z.number().finite()).max(4_096).optional(),
  })
  .strict()

export type MemoryItem = z.infer<typeof MemoryItemSchema>

export const MemoryQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    limit: z.number().int().positive().max(50).default(8),
    includeSensitive: z.boolean().default(false),
    now: z.number().int().nonnegative().optional(),
    embedding: z.array(z.number().finite()).max(4_096).optional(),
  })
  .strict()

export type MemoryQuery = z.infer<typeof MemoryQuerySchema>
export type MemoryQueryInput = z.input<typeof MemoryQuerySchema>

export interface MemorySearchResult {
  item: MemoryItem
  score: number
  matchedTerms: string[]
}

