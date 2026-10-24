import { describe, expect, it } from 'vitest'
import { REALTIME_DEFAULTS } from './realtime-settings'
import {
  realtimeEndpoint,
  realtimeImageEvent,
  realtimeSessionUpdate,
  realtimeHistoryEvent,
  realtimeVadUpdate,
} from './realtime-protocol'
import { normalizeVadThreshold } from './realtime-settings'

describe('realtime protocol adapters', () => {
  it('clamps threshold values and uses protocol-specific live VAD updates', () => {
    expect(normalizeVadThreshold(undefined)).toBe(0.5)
    expect(normalizeVadThreshold(Number.NaN)).toBe(0.5)
    expect(normalizeVadThreshold(5)).toBe(1)
    expect(
      realtimeSessionUpdate({ ...REALTIME_DEFAULTS.dashscope, vadThreshold: 0.72 }, 'persona').session
    ).toMatchObject({ turn_detection: { threshold: 0.72 } })
    expect(realtimeVadUpdate('openai', 0.2)).toMatchObject({
      session: { audio: { input: { turn_detection: { threshold: 0.2 } } } },
    })
    expect(realtimeVadUpdate('dashscope', -1)).toMatchObject({ session: { turn_detection: { threshold: 0 } } })
  })
  it('replays assistant history using GA output_text rather than the legacy text type', () => {
    expect(realtimeHistoryEvent('openai', { role: 'assistant', text: 'hello' }).item.content[0].type).toBe(
      'output_text'
    )
    expect(realtimeHistoryEvent('dashscope', { role: 'assistant', text: 'hello' }).item.content[0].type).toBe('text')
  })
  it('uses genuine audio sessions and different provider schemas', () => {
    expect(realtimeSessionUpdate(REALTIME_DEFAULTS.openai, 'persona').session).toMatchObject({
      type: 'realtime',
      output_modalities: ['audio'],
      audio: { input: { format: { rate: 24000 } } },
    })
    expect(realtimeSessionUpdate(REALTIME_DEFAULTS.dashscope, 'persona').session).toMatchObject({
      modalities: ['text', 'audio'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
    })
  })
  it('does not leak keys through URLs', () => {
    expect(() =>
      realtimeEndpoint({ ...REALTIME_DEFAULTS.openai, endpoint: 'wss://host/realtime?api_key=secret' })
    ).toThrow('credentials_in_url')
    expect(() => realtimeEndpoint({ ...REALTIME_DEFAULTS.openai, endpoint: 'ws://host/realtime' })).toThrow(
      'wss_required'
    )
    expect(new URL(realtimeEndpoint(REALTIME_DEFAULTS.dashscope)).searchParams.get('model')).toBe(
      'qwen3.8-omni-flash-realtime'
    )
  })
  it('uses the real image events for each protocol', () => {
    expect(realtimeImageEvent('dashscope', 'frame')).toEqual({ type: 'input_image_buffer.append', image: 'frame' })
    expect(realtimeImageEvent('openai', 'frame')).toMatchObject({
      type: 'conversation.item.create',
      item: { content: [{ type: 'input_image' }] },
    })
  })
})
