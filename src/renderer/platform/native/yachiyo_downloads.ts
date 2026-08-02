import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface DownloadSettings {
  proxy: string
  threads: number
  wifiOnly: boolean
  retryCount: number
  huggingFaceMirror: boolean
  githubMirror: boolean
  regionInitialized?: boolean
  detectedCountry?: string
}

export interface DownloadNetworkStatus {
  connected: boolean
  wifi: boolean
  metered: boolean
}

interface YachiyoDownloadsPlugin {
  list(): Promise<{ tasks: NativeDownloadTask[] }>
  probe(options: { url: string; maximumBytes: number }): Promise<{ url: string; size: number }>
  enqueue(options: GenericDownloadRequest): Promise<{ accepted: boolean; id: string; reused?: boolean }>
  pause(options: { id: string }): Promise<{ accepted: boolean; id: string }>
  resume(options: { id: string }): Promise<{ accepted: boolean; id: string }>
  cancel(options: { id: string }): Promise<{ accepted: boolean; id: string }>
  readCompleted(options: { id: string; offset?: number; length?: number }): Promise<{
    data: string
    offset: number
    bytesRead: number
    total: number
    done: boolean
  }>
  removeArtifact(options: { id: string; keepRecord?: boolean }): Promise<void>
  getSettings(): Promise<DownloadSettings>
  networkStatus(): Promise<DownloadNetworkStatus>
  initializeRegionalDefaults(): Promise<DownloadSettings>
  saveSettings(options: DownloadSettings): Promise<DownloadSettings>
  /** Remove a terminal task row from the unified index (does not touch in-flight work). */
  remove(options: { id: string }): Promise<{ tasks: NativeDownloadTask[] }>
  /** Reads and clears a pending in-app navigation set by a download notification tap. */
  consumePendingRoute(): Promise<{ route: string }>
  addListener(eventName: 'route', listener: (event: { route: string }) => void): Promise<PluginListenerHandle>
}

export interface GenericDownloadRequest {
  id: string
  kind: 'plugin' | 'skill' | 'theme' | 'resource' | string
  title: string
  url: string
  expectedSize: number
  expectedSha256?: string
}

export interface NativeDownloadTask {
  id: string
  kind: 'model' | 'update' | 'sandbox' | string
  title: string
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'
  bytesDownloaded: number
  bytesTotal: number
  bytesPerSecond: number
  updatedAt: number
  error?: string
}

export const yachiyoDownloadsNative = registerPlugin<YachiyoDownloadsPlugin>('YachiyoDownloads')

/** Reads a completed generic artifact without creating an unbounded native bridge payload. */
export async function readCompletedDownload(id: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let offset = 0
  let total = 0
  do {
    const result = await yachiyoDownloadsNative.readCompleted({ id, offset })
    const binary = atob(result.data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    chunks.push(bytes)
    offset += result.bytesRead
    total = result.total
    if (result.done) break
  } while (offset < total)
  const merged = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    merged.set(chunk, cursor)
    cursor += chunk.length
  }
  return merged
}
