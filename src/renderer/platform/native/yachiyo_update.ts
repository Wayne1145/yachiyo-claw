import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface NativeUpdateProgressEvent {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface YachiyoUpdatePlugin {
  downloadUpdate(options: {
    version: string
    url: string
    size: number
    sha256?: string
    sha256SidecarUrl?: string
  }): Promise<{ version: string }>
  getInstallPermission(): Promise<{ granted: boolean }>
  openInstallPermissionSettings(): Promise<void>
  installUpdate(): Promise<{ permissionRequired: boolean }>
  addListener(eventName: 'progress', listener: (event: NativeUpdateProgressEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'downloaded', listener: (event: { version: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'error', listener: (event: { message: string }) => void): Promise<PluginListenerHandle>
}

export const yachiyoUpdateNative = registerPlugin<YachiyoUpdatePlugin>('YachiyoUpdate')
