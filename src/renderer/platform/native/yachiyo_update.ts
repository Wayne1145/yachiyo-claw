import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { createFeatureGatedPlugin } from './feature-gated-plugin'

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
  getDownloadStatus(): Promise<NativeUpdateDownloadStatus>
  pauseDownload(options: { version: string }): Promise<{ accepted: boolean }>
  resumeDownload(options: { version: string }): Promise<{ accepted: boolean }>
  cancelDownload(options: { version: string }): Promise<{ accepted: boolean }>
  addListener(eventName: 'progress', listener: (event: NativeUpdateProgressEvent) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'downloaded', listener: (event: { version: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'error', listener: (event: { message: string }) => void): Promise<PluginListenerHandle>
}

export interface NativeUpdateDownloadStatus {
  ready: boolean
  version: string
  status: 'idle' | 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  bytesDownloaded?: number
  bytesTotal?: number
  bytesPerSecond?: number
  error?: string
}

export const yachiyoUpdateNative = createFeatureGatedPlugin(
  'updater',
  registerPlugin<YachiyoUpdatePlugin>('YachiyoUpdate'),
)
