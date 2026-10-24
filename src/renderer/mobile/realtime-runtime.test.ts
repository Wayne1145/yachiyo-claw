import { afterEach, describe, expect, it, vi } from 'vitest'
import { tool } from 'ai'
import { z } from 'zod'
import type { RealtimeNative } from '@/platform/native/yachiyo_realtime'
import { RealtimeCall, type RealtimeCallbacks } from './realtime-runtime'
import { REALTIME_DEFAULTS } from './realtime-settings'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const callbacks: RealtimeCallbacks = {
    onState: vi.fn(),
    onSpeaking: vi.fn(),
    onInputLevel: vi.fn(),
    onText: vi.fn(),
    onTranscript: vi.fn(async () => undefined),
    onError: vi.fn(),
  }
  const handlers = new Map<string, (event: unknown) => void>()
  const native = {
    connect: vi.fn(async () => ({ connected: true })),
    sendEvent: vi.fn(async (_options: { connectionId: string; event: unknown }) => undefined),
    startMicrophone: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    setMicrophoneMuted: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    addListener: vi.fn(async (name: string, listener: (event: unknown) => void) => {
      handlers.set(name, listener)
      return { remove: vi.fn(async () => undefined) }
    }),
  }
  const call = new RealtimeCall(REALTIME_DEFAULTS.openai, callbacks, native as RealtimeNative)
  const emit = (event: unknown) => handlers.get('realtimeEvent')?.({ connectionId: call.id, event })
  return { call, callbacks, native, emit, handlers }
}

describe('genuine realtime session', () => {
  it('keeps the upstream error when a generic transport failure arrives afterward', async () => {
    const { call, emit, handlers, callbacks } = fixture()
    await call.connect('test-key', 'persona', [], {}, [])
    emit({ type: 'session.updated' })
    emit({ type: 'error', error: { message: 'Voice is not supported' } })
    handlers.get('realtimeState')?.({ connectionId: call.id, state: 'error', error: 'realtime_connection_failed' })
    expect(callbacks.onError).toHaveBeenLastCalledWith('Voice is not supported')
    await call.close()
  })
  it('separates input mute from output mute and sends threshold updates without replacing instructions', async () => {
    const { call, native, handlers, callbacks, emit } = fixture()
    await call.connect('test-key', 'persona', [], {}, [])
    emit({ type: 'session.updated' })
    await vi.waitFor(() => expect(native.startMicrophone).toHaveBeenCalledOnce())
    await call.setMicrophoneMuted(true)
    expect(native.setMicrophoneMuted).toHaveBeenCalledWith({ connectionId: call.id, muted: true })
    await call.setVadThreshold(0.8)
    expect(native.sendEvent).toHaveBeenCalledWith({
      connectionId: call.id,
      event: {
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            input: {
              turn_detection: { type: 'server_vad', threshold: 0.8, prefix_padding_ms: 300, silence_duration_ms: 650 },
            },
          },
        },
      },
    })
    handlers.get('realtimeLevel')?.({ connectionId: 'stale', level: 0.5 })
    expect(callbacks.onInputLevel).not.toHaveBeenCalled()
    handlers.get('realtimeLevel')?.({ connectionId: call.id, level: 0.65 })
    expect(callbacks.onInputLevel).toHaveBeenCalledWith(0.65)
    await call.close()
  })
  it('surfaces failed responses instead of silently waiting without audio', async () => {
    const { call, emit, callbacks } = fixture()
    await call.connect('test-key', 'persona', [], {}, [])
    emit({ type: 'session.updated' })
    emit({
      type: 'response.done',
      response: { status: 'failed', status_details: { error: { message: 'upstream_unavailable' } } },
    })
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalledWith('upstream_unavailable'))
    await call.close()
  })
  it('waits for session acknowledgement before starting microphone, and persists transcripts', async () => {
    const { call, native, callbacks, emit } = fixture()
    await call.connect('test-key', 'persona', [], {}, [])
    expect(native.startMicrophone).not.toHaveBeenCalled()
    emit({ type: 'session.updated' })
    await vi.waitFor(() => expect(native.startMicrophone).toHaveBeenCalledOnce())
    emit({ type: 'response.output_audio_transcript.delta', item_id: 'a', delta: 'Hello' })
    emit({ type: 'response.output_audio_transcript.done', item_id: 'a', transcript: 'Hello world' })
    await vi.waitFor(() =>
      expect(callbacks.onTranscript).toHaveBeenCalledWith(
        `${call.id}:a`,
        'assistant',
        'Hello world',
        expect.any(Number)
      )
    )
    await call.close()
    expect(native.disconnect).toHaveBeenCalledOnce()
  })
  it('validates tool arguments, reports execution failures, and resumes after tool output', async () => {
    const { call, native, emit } = fixture()
    const execute = vi.fn(async (_input: { value: number }): Promise<{ ok: boolean }> => {
      throw new Error('expected_tool_error')
    })
    const tools = { test: tool({ inputSchema: z.object({ value: z.number() }), execute }) }
    await call.connect('test-key', 'persona', [], tools, [])
    emit({ type: 'session.updated' })
    emit({ type: 'response.function_call_arguments.done', call_id: 'one', name: 'test', arguments: '{"value":1}' })
    emit({
      type: 'response.done',
      response: {
        id: 'r',
        output: [{ type: 'function_call', call_id: 'one', name: 'test', arguments: '{"value":1}' }],
      },
    })
    await vi.waitFor(() =>
      expect(native.sendEvent).toHaveBeenCalledWith(expect.objectContaining({ event: { type: 'response.create' } }))
    )
    expect(execute).toHaveBeenCalledOnce()
    expect(native.sendEvent.mock.calls.some(([args]) => JSON.stringify(args).includes('expected_tool_error'))).toBe(
      true
    )
    emit({
      type: 'response.function_call_arguments.done',
      call_id: 'invalid',
      name: 'test',
      arguments: '{"value":"bad"}',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).toHaveBeenCalledOnce()
    await call.close()
  })
  it('does not start audio after a rejected session or accept stale connection events', async () => {
    const { call, native, emit, callbacks } = fixture()
    await call.connect('test-key', 'persona', [], {}, [])
    emit({ type: 'error', error: { message: 'unsupported_model' } })
    await vi.waitFor(() => expect(native.disconnect).toHaveBeenCalledOnce())
    emit({ type: 'session.updated' })
    expect(native.startMicrophone).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledWith('unsupported_model')
  })
})
