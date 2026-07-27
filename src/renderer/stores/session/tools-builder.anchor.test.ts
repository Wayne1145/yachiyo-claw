import type { ModelInterface } from '@shared/models/types'
import { describe, expect, it, vi } from 'vitest'
import { buildToolsForSession } from '@/stores/session/tools-builder'

/**
 * Regression anchor for migration-02.
 *
 * Locks the model-visible surface of `buildToolsForSession` — the sorted tool-name list and the
 * instructions string — for representative option sets, via inline snapshots recorded on first run.
 * When `buildToolsForSession` is later refactored to iterate the toolset registry, these snapshots
 * must remain byte-for-byte identical, proving the refactor did not change what the model sees.
 */

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({ webSearch: { provider: 'bing' } }),
}))

function makeModel(): ModelInterface {
  return { isSupportToolUse: () => true } as unknown as ModelInterface
}

async function surface(options: Parameters<typeof buildToolsForSession>[1]) {
  const result = await buildToolsForSession(makeModel(), options)
  return {
    tools: Object.keys(result.tools).sort(),
    instructions: result.instructions,
    activeTools: result.activeTools ? [...result.activeTools].sort() : undefined,
  }
}

describe('buildToolsForSession model-visible surface (anchor)', () => {
  it('web browsing enabled', async () => {
    const { tools, instructions } = await surface({ webBrowsing: true, messages: [] })
    expect(tools).toMatchInlineSnapshot(`
      [
        "forget_long_term_memory",
        "remember_long_term_memory",
        "search_long_term_memory",
        "web_search",
      ]
    `)
    expect(instructions).toMatchInlineSnapshot(`
      "
      Use web_search to search the web when doing so would genuinely improve your answer.

      ## web_search
      Search the web when the question benefits from fresh, real-time, or source-specific information — e.g. current events, recent releases, live data, or facts you aren't confident about. For questions you can already answer well from your own knowledge, answer directly. Use short, concise queries (English preferred).

      <long_term_memory>Use long-term memory proactively. Search when prior preferences, facts, goals, or project conventions may help. Silently save durable information the user clearly states, and update or remove stale entries when appropriate. Never store credentials, authentication data, one-time codes, medical details, or other sensitive content. Do not save transient requests or speculate about the user.</long_term_memory>
      "
    `)
  })

  it('device control enabled', async () => {
    const { tools, activeTools, instructions } = await surface({ webBrowsing: false, messages: [], deviceControlEnabled: true })
    expect(tools).toMatchInlineSnapshot(`
      [
        "forget_long_term_memory",
        "remember_long_term_memory",
        "search_long_term_memory",
      ]
    `)
    expect(activeTools).toMatchInlineSnapshot(`undefined`)
    expect(instructions).toMatchInlineSnapshot(`
      "
      <long_term_memory>Use long-term memory proactively. Search when prior preferences, facts, goals, or project conventions may help. Silently save durable information the user clearly states, and update or remove stale entries when appropriate. Never store credentials, authentication data, one-time codes, medical details, or other sensitive content. Do not save transient requests or speculate about the user.</long_term_memory>
      "
    `)
  })

  it('sandbox enabled', async () => {
    const { tools, instructions } = await surface({ webBrowsing: false, messages: [], sandboxEnabled: true })
    expect(tools).toMatchInlineSnapshot(`
      [
        "forget_long_term_memory",
        "remember_long_term_memory",
        "sandbox_bash",
        "sandbox_edit",
        "sandbox_find",
        "sandbox_grep",
        "sandbox_job_output",
        "sandbox_job_status",
        "sandbox_ls",
        "sandbox_read",
        "sandbox_start_background",
        "sandbox_stop_job",
        "sandbox_write",
        "search_long_term_memory",
      ]
    `)
    expect(instructions.length).toMatchInlineSnapshot(`2258`)
  })

  it('nothing enabled yields the mcp baseline', async () => {
    const { tools, instructions, activeTools } = await surface({ webBrowsing: false, messages: [] })
    expect(tools).toMatchInlineSnapshot(`
      [
        "forget_long_term_memory",
        "remember_long_term_memory",
        "search_long_term_memory",
      ]
    `)
    expect(instructions).toMatchInlineSnapshot(`
      "
      <long_term_memory>Use long-term memory proactively. Search when prior preferences, facts, goals, or project conventions may help. Silently save durable information the user clearly states, and update or remove stale entries when appropriate. Never store credentials, authentication data, one-time codes, medical details, or other sensitive content. Do not save transient requests or speculate about the user.</long_term_memory>
      "
    `)
    expect(activeTools).toMatchInlineSnapshot(`undefined`)
  })
})
