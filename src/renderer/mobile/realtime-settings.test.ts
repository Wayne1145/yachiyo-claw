/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getRealtimeSettings,
  normalizeRealtimeSettings,
  REALTIME_DEFAULTS,
  saveRealtimeSettings,
} from './realtime-settings'

const CONFIG_KEY = 'yachiyo.realtime.settings.v1'
describe('Realtime default configuration compatibility', () => {
  beforeEach(() => localStorage.clear())
  it('ships the model ID and voice verified against DashScope', () => {
    expect(REALTIME_DEFAULTS.dashscope).toMatchObject({ model: 'qwen3.8-omni-flash-realtime', voice: 'Tina' })
  })
  it('repairs the old official template without touching credentials or unrelated options', () => {
    const old = {
      ...REALTIME_DEFAULTS.dashscope,
      model: 'Qwen3.8-Omni-Flash-Realtime',
      voice: 'Cherry',
      video: true,
      vadThreshold: 0.72,
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(old))
    localStorage.setItem('yachiyo.realtime.credentials.v1', 'opaque-test-envelope')
    expect(getRealtimeSettings()).toMatchObject({
      model: 'qwen3.8-omni-flash-realtime',
      voice: 'Tina',
      video: true,
      vadThreshold: 0.72,
      endpoint: old.endpoint,
    })
    expect(localStorage.getItem('yachiyo.realtime.credentials.v1')).toBe('opaque-test-envelope')
  })
  it('also repairs Cherry when the user already corrected the model ID, including workspace endpoints', () => {
    expect(
      normalizeRealtimeSettings({
        ...REALTIME_DEFAULTS.dashscope,
        voice: 'Cherry',
        endpoint: 'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime',
      })
    ).toMatchObject({ voice: 'Tina' })
  })
  it('preserves explicit custom voices, other models, and other providers', () => {
    expect(normalizeRealtimeSettings({ ...REALTIME_DEFAULTS.dashscope, voice: 'Ethan' }).voice).toBe('Ethan')
    expect(
      normalizeRealtimeSettings({ ...REALTIME_DEFAULTS.dashscope, model: 'qwen-omni-turbo-realtime', voice: 'Cherry' })
        .voice
    ).toBe('Cherry')
    expect(normalizeRealtimeSettings(REALTIME_DEFAULTS.openai)).toEqual(REALTIME_DEFAULTS.openai)
  })
  it('does not rewrite custom gateway naming or trust lookalike domains', () => {
    for (const endpoint of ['wss://gateway.example/realtime', 'wss://dashscope.aliyuncs.com.example/realtime']) {
      const settings = {
        ...REALTIME_DEFAULTS.dashscope,
        endpoint,
        model: 'Qwen3.8-Omni-Flash-Realtime',
        voice: 'Cherry',
      }
      expect(normalizeRealtimeSettings(settings)).toEqual(settings)
    }
  })
  it('saves the corrected values so reopening settings retains them', () => {
    saveRealtimeSettings({ ...REALTIME_DEFAULTS.dashscope, model: 'Qwen3.8-Omni-Flash-Realtime', voice: 'Cherry' })
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')).toMatchObject({
      model: 'qwen3.8-omni-flash-realtime',
      voice: 'Tina',
    })
  })
})
