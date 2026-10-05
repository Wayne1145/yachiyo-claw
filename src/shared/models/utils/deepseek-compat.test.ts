import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import type { ModelDependencies } from '../../types/adapters'
import CustomOpenAI from '../../providers/definitions/models/custom-openai'
import DeepSeek from '../../providers/definitions/models/deepseek'
import { normalizeDeepSeekChatBody } from './deepseek-compat'

type WireMessage = { role: string; reasoning_content?: string }
type WireRequest = { tool_choice?: string; messages: WireMessage[] }

describe('DeepSeek thinking/tool compatibility', () => {
  it('does not rewrite other providers or non-chat requests', () => {
    const body = JSON.stringify({ model: 'gpt-5.6', messages: [], tool_choice: 'required' })
    expect(normalizeDeepSeekChatBody('https://api.example.com/v1/chat/completions', body)).toBe(body)
    expect(normalizeDeepSeekChatBody('https://api.deepseek.com/models', undefined)).toBeUndefined()
    expect(normalizeDeepSeekChatBody('https://api.deepseek.com/v1/chat/completions', 'invalid')).toBe('invalid')
  })

  it('retains recorded reasoning and does not change explicitly disabled thinking', () => {
    const body = JSON.stringify({
      model: 'deepseek-flash', thinking: { type: 'disabled' }, tool_choice: 'auto',
      messages: [{ role: 'assistant', content: 'hello', reasoning_content: 'recorded reasoning' }],
    })
    expect(JSON.parse(normalizeDeepSeekChatBody('https://gateway.example/v1/chat/completions', body) as string))
      .toEqual(JSON.parse(body))
  })

  it.each(['custom-stream', 'custom-chat', 'builtin-stream'])(
    '%s completes two Agent tool rounds and preserves reasoning on the wire',
    async (mode) => {
      const requests: WireRequest[] = []
      const execute = vi.fn(async () => ({ ok: true }))
      const apiRequest = vi.fn(async (options: { body?: unknown }) => {
        const body = JSON.parse(String(options.body)) as WireRequest
        requests.push(body)
        // Reproduce the server's actual validation, including a follow-up round.
        expect(body.tool_choice).toBe('auto')
        expect(body.messages.filter(m => m.role === 'assistant')
          .every(m => typeof m.reasoning_content === 'string')).toBe(true)
        if (requests.length === 2) {
          expect(body.messages.some(m => m.reasoning_content === 'Inspect the environment.')).toBe(true)
          expect(body.messages.some(m => m.role === 'tool')).toBe(true)
        }
        const name = requests.length === 1 ? 'inspect' : 'agent_complete'
        const chunks = [
          { choices: [{ index: 0, delta: { reasoning_content: 'Inspect the environment.' }, finish_reason: null }] },
          { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name, arguments: '{}' } }] }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 8 } },
        ]
        return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const dependencies = { request: { apiRequest }, sentry: { withScope: vi.fn(), captureException: vi.fn() } } as unknown as ModelDependencies
      const options = {
        apiKey: 'test-only', apiHost: 'https://api.deepseek.com/v1', apiPath: '/chat/completions',
        model: { modelId: 'deepseek-flash', capabilities: ['tool_use', 'reasoning'] as ('tool_use' | 'reasoning')[] },
        stream: true,
      }
      const model = mode === 'builtin-stream' ? new DeepSeek(options, dependencies) : new CustomOpenAI(options, dependencies)
      expect(model.shouldPreserveReasoning()).toBe(true)
      const messages = [
        { role: 'assistant' as const, content: 'Earlier reply from a different model.' },
        { role: 'user' as const, content: 'Inspect your environment and finish.' },
      ]
      const callOptions = {
        agentMode: true,
        tools: {
          inspect: tool({ inputSchema: z.object({}), execute }),
          agent_complete: tool({ inputSchema: z.object({}), execute }),
        },
      }
      if (mode === 'custom-chat') {
        await model.chat(messages, callOptions)
      } else {
        for await (const part of model.chatStream(messages, callOptions)) {
          expect(part.type).not.toBe('error')
        }
      }
      expect(requests).toHaveLength(2)
      expect(execute).toHaveBeenCalledTimes(2)
    },
  )
})
