import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface NativeSpeechRecognitionStatus {
  recognitionAvailable: boolean
  offlineAvailable: boolean
  systemRecognitionAvailable: boolean
  onDeviceAvailable: boolean
  serviceCount: number
  listening: boolean
}

export interface NativeSpeechRecognitionEvent {
  sessionId: number
  text: string
}

export interface NativeSpeechRecognitionStateEvent {
  sessionId: number
  active: boolean
  state: 'starting' | 'listening' | 'speech' | 'processing' | 'finished'
}

interface YachiyoVoicePlugin {
  getRecognitionStatus(): Promise<NativeSpeechRecognitionStatus>
  startListening(options?: {
    language?: string
    engine?: 'offline' | 'system'
    preferOnDevice?: boolean
  }): Promise<{ text: string }>
  stopListening(): Promise<void>
  speak(options: { text: string }): Promise<void>
  stopSpeaking(): Promise<void>
  addListener(
    eventName: 'speechPartialResult',
    listener: (event: NativeSpeechRecognitionEvent) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'speechRecognitionStateChanged',
    listener: (event: NativeSpeechRecognitionStateEvent) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'ttsStateChanged',
    listener: (event: { active: boolean; utteranceId?: string }) => void
  ): Promise<PluginListenerHandle>
}

export const yachiyoVoiceNative = registerPlugin<YachiyoVoicePlugin>('YachiyoVoice')
