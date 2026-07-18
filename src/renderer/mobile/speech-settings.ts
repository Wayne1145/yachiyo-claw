export type ASRProvider = 'android-local' | 'openai-compatible' | 'aliyun' | 'volcengine' | 'custom'
export type TTSProvider =
  | 'bing'
  | 'android-system'
  | 'openai-compatible'
  | 'aliyun'
  | 'volcengine'
  | 'gpt-sovits'
  | 'custom'

export interface SpeechSettings {
  asrProvider: ASRProvider
  asrBaseUrl: string
  asrModel: string
  asrHeaders: string
  ttsProvider: TTSProvider
  ttsBaseUrl: string
  ttsModel: string
  ttsHeaders: string
  voice: string
  language: string
}

const KEY = 'yachiyo.speech.settings.v2'
export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  asrProvider: 'android-local',
  asrBaseUrl: '',
  asrModel: 'whisper-1',
  asrHeaders: '',
  ttsProvider: 'bing',
  ttsBaseUrl: '',
  ttsModel: 'tts-1',
  ttsHeaders: '',
  voice: 'zh-CN-XiaoxiaoNeural',
  language: 'zh-CN',
}

export function getSpeechSettings(): SpeechSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SPEECH_SETTINGS
  try {
    return { ...DEFAULT_SPEECH_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULT_SPEECH_SETTINGS
  }
}

export function saveSpeechSettings(settings: SpeechSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event('yachiyo-speech-settings-changed'))
}

export function getSpeechProviderDefaults(provider: ASRProvider | TTSProvider, kind: 'asr' | 'tts') {
  if (provider === 'aliyun') {
    return kind === 'asr'
      ? { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'paraformer-realtime-v2' }
      : { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-tts' }
  }
  if (provider === 'volcengine') {
    return kind === 'asr'
      ? { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' }
      : { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' }
  }
  if (provider === 'gpt-sovits') return { baseUrl: 'http://127.0.0.1:9880', model: 'zh' }
  return { baseUrl: '', model: kind === 'asr' ? 'whisper-1' : 'tts-1' }
}

export function resolveSpeechEndpoint(baseUrl: string, path: '/audio/transcriptions' | '/audio/speech' | '/tts'): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('speech_api_url_required')
  if (normalized.endsWith(path)) return normalized
  return `${normalized}${path}`
}

export function parseSpeechHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('speech_headers_invalid')
  return Object.fromEntries(Object.entries(parsed).map(([key, headerValue]) => [key, String(headerValue)]))
}
