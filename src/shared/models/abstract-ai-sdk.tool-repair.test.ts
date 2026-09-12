import type { JSONSchema7, LanguageModelV3ToolCall } from '@ai-sdk/provider'
import { tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { repairWrappedToolCall } from './abstract-ai-sdk'

const tools = {
  sandbox_write: tool({
    inputSchema: z.object({ path: z.string(), content: z.string() }),
  }),
}

const baseCall: LanguageModelV3ToolCall = {
  type: 'tool-call',
  toolCallId: 'call-1',
  toolName: 'sandbox_write',
  input: '',
}

const inputSchema = async (): Promise<JSONSchema7> => ({
  type: 'object' as const,
  properties: { path: { type: 'string' as const }, content: { type: 'string' as const } },
  required: ['path', 'content'],
})

describe('repairWrappedToolCall', () => {
  it.each(['arguments', 'input'])('unwraps a single %s object', async (wrapper) => {
    const repaired = await repairWrappedToolCall({
      toolCall: { ...baseCall, input: JSON.stringify({ [wrapper]: { path: 'index.html', content: 'ok' } }) },
      tools,
      inputSchema,
      system: undefined,
      messages: [],
      error: {} as never,
    })

    expect(repaired && JSON.parse(repaired.input)).toEqual({ path: 'index.html', content: 'ok' })
  })

  it('does not guess unknown tools or malformed argument text', async () => {
    const unknown = await repairWrappedToolCall({
      toolCall: { ...baseCall, toolName: 'missing', input: '{"arguments":{}}' },
      tools,
      inputSchema,
      system: undefined,
      messages: [],
      error: {} as never,
    })
    const malformed = await repairWrappedToolCall({
      toolCall: { ...baseCall, input: '{"arguments":"not-json"}' },
      tools,
      inputSchema,
      system: undefined,
      messages: [],
      error: {} as never,
    })

    expect(unknown).toBeNull()
    expect(malformed).toBeNull()
  })
})
