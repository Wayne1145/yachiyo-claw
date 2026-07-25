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
    const model = new LocalNativeModel({ modelId: 'gemma-4-e4b' } as never, dependencies(adapter))
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
})
