import { tool } from 'ai'
import { z } from 'zod'
import { requestAgentApproval } from '@/mobile/agent-approval'
import { createDefaultLongTermMemoryService } from '@/mobile/long-term-memory'

export function createLongTermMemoryToolSet(sessionId?: string) {
  const memory = createDefaultLongTermMemoryService()
  return {
    description:
      '\n<long_term_memory>Search relevant user-approved long-term memories. Never store secrets or sensitive content; ask for confirmation before saving or deleting.</long_term_memory>\n',
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
        description: 'Save a non-sensitive fact, preference, goal, or note after explicit user confirmation.',
        inputSchema: z.object({
          content: z.string().min(1).max(8_000),
          kind: z.enum(['fact', 'preference', 'goal', 'note']).optional(),
          tags: z.array(z.string().min(1).max(64)).max(16).optional(),
        }),
        execute: async ({ content, kind, tags }) => {
          const approved = await requestAgentApproval({
            sessionId,
            title: '保存长期记忆',
            detail: content.slice(0, 500),
            risk: 'dangerous',
          })
          if (!approved) return { saved: false, reason: 'user_denied' }
          const item = await memory.saveCandidate({ content, kind, tags, sourceSessionId: sessionId })
          return item ? { saved: true, id: item.id } : { saved: false, reason: 'content_rejected' }
        },
      }),
      forget_long_term_memory: tool({
        description: 'Delete one previously saved memory after explicit user confirmation.',
        inputSchema: z.object({ id: z.string().min(1).max(128) }),
        execute: async ({ id }) => {
          const approved = await requestAgentApproval({
            sessionId,
            title: '删除长期记忆',
            detail: id,
            risk: 'dangerous',
          })
          if (!approved) return { deleted: false, reason: 'user_denied' }
          return { deleted: await memory.remove(id) }
        },
      }),
    },
  }
}

export default createLongTermMemoryToolSet()
