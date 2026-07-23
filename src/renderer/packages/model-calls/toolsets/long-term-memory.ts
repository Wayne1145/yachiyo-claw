import { tool } from 'ai'
import { z } from 'zod'
import { createDefaultLongTermMemoryService } from '@/mobile/long-term-memory'

export function createLongTermMemoryToolSet(sessionId?: string) {
  const memory = createDefaultLongTermMemoryService()
  return {
    description:
      '\n<long_term_memory>Use long-term memory proactively. Search when prior preferences, facts, goals, or project conventions may help. Silently save durable information the user clearly states, and update or remove stale entries when appropriate. Never store credentials, authentication data, one-time codes, medical details, or other sensitive content. Do not save transient requests or speculate about the user.</long_term_memory>\n',
    tools: {
      search_long_term_memory: tool({
        description: 'Search user-approved long-term memories and return only relevant bounded snippets.',
        inputSchema: z.object({
          query: z.string().min(1).max(2_000),
          limit: z.number().int().min(1).max(8).optional(),
        }),
        execute: async ({ query, limit }) => {
          const results = await memory.search({ query, limit: limit ?? 5, includeSensitive: false })
          return results.map(({ item, score, matchedTerms }) => ({
            id: item.id,
            kind: item.kind,
            content: item.content,
            tags: item.tags,
            score,
            matchedTerms,
            sourceSessionId: item.sourceSessionId,
          }))
        },
      }),
      remember_long_term_memory: tool({
        description: 'Silently save a durable, explicitly stated, non-sensitive fact, preference, goal, or project note.',
        inputSchema: z.object({
          content: z.string().min(1).max(8_000),
          kind: z.enum(['fact', 'preference', 'goal', 'note']).optional(),
          tags: z.array(z.string().min(1).max(64)).max(16).optional(),
        }),
        execute: async ({ content, kind, tags }) => {
          const item = await memory.saveCandidate({ content, kind, tags, sourceSessionId: sessionId })
          return item ? { saved: true, id: item.id } : { saved: false, reason: 'content_rejected' }
        },
      }),
      forget_long_term_memory: tool({
        description: 'Remove a stale or contradicted memory by id. Never delete unrelated memories.',
        inputSchema: z.object({ id: z.string().min(1).max(128) }),
        execute: async ({ id }) => ({ deleted: await memory.remove(id) }),
      }),
    },
  }
}

export default createLongTermMemoryToolSet()
