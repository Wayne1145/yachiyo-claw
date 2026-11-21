import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface RealtimeNativeEvent {
  connectionId: string
  event: Record<string, unknown>
}
export interface RealtimeNativeState {
  connectionId: string
  state: 'speaking' | 'silent' | 'error' | 'disconnected'
  error?: string
}
export interface RealtimeNative {
  connect(options: {
    connectionId: string
    endpoint: string
    apiKey: string
    sessionUpdate: unknown
    inputRate: number
    outputRate: number
    muted?: boolean
    microphoneMuted?: boolean
  }): Promise<{ connected: boolean }>
  startMicrophone(options: { connectionId: string }): Promise<void>
  sendEvent(options: { connectionId: string; event: unknown }): Promise<void>
  setMuted(options: { connectionId: string; muted: boolean }): Promise<void>
  setMicrophoneMuted(options: { connectionId: string; muted: boolean }): Promise<void>
  disconnect(options: { connectionId: string }): Promise<void>
  interrupt(options: { connectionId: string }): Promise<void>
  addListener(name: 'realtimeEvent', callback: (event: RealtimeNativeEvent) => void): Promise<PluginListenerHandle>
  addListener(name: 'realtimeState', callback: (event: RealtimeNativeState) => void): Promise<PluginListenerHandle>
  addListener(
    name: 'realtimeLevel',
    callback: (event: { connectionId: string; level: number }) => void
  ): Promise<PluginListenerHandle>
}
export const yachiyoRealtimeNative = registerPlugin<RealtimeNative>('YachiyoRealtime')
