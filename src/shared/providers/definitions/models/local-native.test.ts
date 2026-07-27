import { describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import type { LocalInferenceAdapter, ModelDependencies } from '../../../types/adapters'
import LocalNativeModel from './local-native'

function dependencies(adapter: LocalInferenceAdapter): ModelDependencies {
  return { localInference: adapter } as ModelDependencies
}

describe('LocalNativeModel', () => {
  it('reports the precise native availability failure', async () => {
    const adapter = {
      isAvailable: vi.fn(async () => false),
      checkAvailability: vi.fn(async () => ({ available: false, reason: 'local_model_file_missing' })),
      stream: vi.fn(),
    } as unknown as LocalInferenceAdapter
    const model = new LocalNativeModel({ modelId: 'gemma-4-e4b' } as never, dependencies(adapter))

    await expect(model.chatStream([], {}).next()).rejects.toThrow(
      'local_model_not_available:local_model_file_missing',
    )
  })

  it('executes structured calls through the supplied broker-backed tool and continues the local loop', async () => {
    let request = 0
    const adapter: LocalInferenceAdapter = {
      isAvailable: vi.fn(async () => true),
      checkAvailability: vi.fn(async () => ({ available: true, runtime: 'llama.cpp' })),
      async *stream(_modelId, input) {
        request += 1
        if (request === 1) {
          expect(input.tools).toHaveProperty('device_info')
          yield { type: 'tool-call', name: 'device_info', arguments: {}, callId: 'call-1' }
        } else {
          expect(JSON.stringify(input.messages)).toContain('Pixel')
          yield { type: 'text', text: 'The device is a Pixel.' }
        }
      },
    }
    const execute = vi.fn(async () => ({ model: 'Pixel' }))
    const model = new LocalNativeModel(
      { modelId: 'gemma-4-e4b', capabilities: ['tool_use'] } as never,
      dependencies(adapter),
    )
    const events = []

    for await (const event of model.chatStream([], {
      agentMode: true,
      tools: {
        device_info: tool({ description: 'Device info', inputSchema: z.object({}), execute }),
      },
    })) {
      events.push(event)
    }

    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ toolCallId: 'call-1', messages: expect.any(Array) }),
    )
    expect(events.map((event) => event.type)).toEqual(['tool-call', 'tool-result', 'text-delta', 'finish'])
  })

  it('does not expose tools to a chat-only local model', async () => {
    const adapter: LocalInferenceAdapter = {
      isAvailable: vi.fn(async () => true),
      checkAvailability: vi.fn(async () => ({ available: true, runtime: 'llama.cpp' })),
      async *stream(_modelId, input) {
        expect(input.tools).toBeUndefined()
        yield { type: 'text', text: 'chat only' }
      },
    }
    const model = new LocalNativeModel({ modelId: 'gemma-3-270m-it', capabilities: [] } as never, dependencies(adapter))

    expect(model.isSupportToolUse()).toBe(false)
    for await (const _event of model.chatStream([], {
      tools: {
        device_info: tool({ description: 'Device info', inputSchema: z.object({}), execute: async () => ({}) }),
      },
    })) {
      // Exhaust the stream so the adapter assertions run.
    }
  })

  it('uses a compact system prompt for sub-1B chat-only models', async () => {
    const adapter: LocalInferenceAdapter = {
      isAvailable: vi.fn(async () => true),
      checkAvailability: vi.fn(async () => ({ available: true, runtime: 'llama.cpp' })),
      async *stream(_modelId, input) {
        const system = input.messages[0] as { role: string; content: string }
        expect(system.role).toBe('system')
        expect(system.content).toContain('You are 月见八千代')
        expect(system.content).toContain('Always return visible plain text')
        expect(system.content).not.toContain('very long persona detail')
        yield { type: 'text', text: 'visible response' }
      },
    }
    const model = new LocalNativeModel(
      { modelId: 'gemma-3-270m-it-GGUF', capabilities: [] } as never,
      dependencies(adapter),
    )

    for await (const _event of model.chatStream(
      [
        {
          role: 'system',
          content: '_你不是机器人。你是月见八千代。_\nvery long persona detail'.repeat(100),
        },
        { role: 'user', content: 'hello' },
      ],
      {},
    )) {
      // Exhaust the stream so the adapter assertions run.
    }
  })

  it('keeps explicitly requested tools inside the small-model tool window', async () => {
    const adapter: LocalInferenceAdapter = {
      isAvailable: vi.fn(async () => true),
      checkAvailability: vi.fn(async () => ({ available: true, runtime: 'litert-lm' })),
      async *stream(_modelId, input) {
        const system = input.messages[0] as { role: string; content: string }
        expect(system.content).toContain('tool-using on-device agent')
        expect(system.content.length).toBeLessThan(400)
        expect(Object.keys(input.tools as object)).toHaveLength(1)
        expect(input.tools).toHaveProperty('hello-yachiyo_echo')
        yield { type: 'text', text: 'tool window ready' }
      },
    }
    const tools = Object.fromEntries(
      ['sandbox_exec', 'workspace_read', 'memory_search', 'web_search', 'camera_capture', 'hello-yachiyo_echo'].map(
        (name) => [name, tool({ description: `${name} description`, inputSchema: z.object({}), execute: async () => ({}) })],
      ),
    )
    const model = new LocalNativeModel(
      { modelId: 'functiongemma-270m', capabilities: ['tool_use'] } as never,
      dependencies(adapter),
    )

    for await (const _event of model.chatStream(
      [
        { role: 'system', content: '_你不是机器人。你是月见八千代。_\nfull agent policy'.repeat(100) },
        { role: 'user', content: 'Use hello-yachiyo_echo now.' },
      ],
      { agentMode: true, tools },
    )) {
      // Exhaust the stream so the adapter assertions run.
    }
  })
})
