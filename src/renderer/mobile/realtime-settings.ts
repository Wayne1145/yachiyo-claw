import { Capacitor } from '@capacitor/core'
import {
  decryptMobileProtectedValue,
  encryptMobileProtectedValue,
  isYachiyoSecureStorageEnvelope,
} from '@/platform/native/yachiyo_secure_storage'

export type RealtimeProtocol = 'openai' | 'dashscope'
export interface RealtimeSettings {
  protocol: RealtimeProtocol
  endpoint: string
  model: string
  voice: string
  video: boolean
  vadThreshold: number
}
const CONFIG_KEY = 'yachiyo.realtime.settings.v1'
const KEY = 'yachiyo.realtime.credentials.v1'
const CONTEXT = 'realtime/credentials/v1'
export const REALTIME_DEFAULTS: Record<RealtimeProtocol, RealtimeSettings> = {
  openai: {
    protocol: 'openai',
    endpoint: 'wss://api.openai.com/v1/realtime',
    model: 'gpt-realtime',
    voice: 'marin',
    video: false,
    vadThreshold: 0.5,
  },
  dashscope: {
    protocol: 'dashscope',
    endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    model: 'qwen3.8-omni-flash-realtime',
    voice: 'Tina',
    video: false,
    vadThreshold: 0.5,
  },
}
export function getRealtimeSettings(): RealtimeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    const protocol: RealtimeProtocol = saved.protocol === 'dashscope' ? 'dashscope' : 'openai'
    return normalizeRealtimeSettings({
      ...REALTIME_DEFAULTS[protocol],
      ...saved,
      protocol,
      vadThreshold: normalizeVadThreshold(saved.vadThreshold),
    })
  } catch {
    return { ...REALTIME_DEFAULTS.openai }
  }
}
export function saveRealtimeSettings(value: RealtimeSettings) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeRealtimeSettings(value)))
}
export function normalizeRealtimeSettings(value: RealtimeSettings): RealtimeSettings {
  const normalized = { ...value, vadThreshold: normalizeVadThreshold(value.vadThreshold) }
  let officialDashscope = false
  try {
    const host = new URL(value.endpoint).hostname
    officialDashscope =
      host === 'dashscope.aliyuncs.com' ||
      host.endsWith('.dashscope.aliyuncs.com') ||
      host.endsWith('.maas.aliyuncs.com')
  } catch {
    /* Endpoint validation remains with the settings form and connection layer. */
  }
  // Repair only the known broken official template. Custom gateways and other models may use different names/voices.
  if (
    value.protocol === 'dashscope' &&
    officialDashscope &&
    /^qwen3\.8-omni-flash-realtime$/i.test(value.model.trim())
  ) {
    normalized.model = REALTIME_DEFAULTS.dashscope.model
    if (value.voice.trim() === 'Cherry') normalized.voice = REALTIME_DEFAULTS.dashscope.voice
  }
  return normalized
}
export function normalizeVadThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}
export async function getRealtimeApiKey(): Promise<string> {
  const stored = localStorage.getItem(KEY) || ''
  if (!stored) return ''
  if (Capacitor.isNativePlatform())
    return isYachiyoSecureStorageEnvelope(stored) ? await decryptMobileProtectedValue(stored, CONTEXT) : ''
  return stored
}
export async function saveRealtimeApiKey(key: string): Promise<void> {
  if (!key) {
    localStorage.removeItem(KEY)
    return
  }
  localStorage.setItem(KEY, Capacitor.isNativePlatform() ? await encryptMobileProtectedValue(key, CONTEXT) : key)
}
