import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

interface YachiyoVoicePlugin {
  startListening(options?: { language?: string }): Promise<{ text: string }>
  stopListening(): Promise<void>
  speak(options: { text: string }): Promise<void>
  stopSpeaking(): Promise<void>
  addListener(
    eventName: 'ttsStateChanged',
    listener: (event: { active: boolean; utteranceId?: string }) => void
  ): Promise<PluginListenerHandle>
}

export const yachiyoVoiceNative = registerPlugin<YachiyoVoicePlugin>('YachiyoVoice')
