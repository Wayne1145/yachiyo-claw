export interface SpeechSettings {
  asrProvider: 'android-local' | 'openai-compatible'
  asrModel: string
  ttsProvider: 'bing' | 'android-system' | 'openai-compatible'
  ttsModel: string
  voice: string
}

const KEY = 'yachiyo.speech.settings.v1'
export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  asrProvider: 'android-local', asrModel: 'android-speech-recognizer',
  ttsProvider: 'bing', ttsModel: 'edge-read-aloud', voice: 'zh-CN-XiaoxiaoNeural',
}

export function getSpeechSettings(): SpeechSettings {
  try { return { ...DEFAULT_SPEECH_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } }
  catch { return DEFAULT_SPEECH_SETTINGS }
}

export function saveSpeechSettings(settings: SpeechSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event('yachiyo-speech-settings-changed'))
}
