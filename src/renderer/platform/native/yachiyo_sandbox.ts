import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { createFeatureGatedPlugin } from './feature-gated-plugin'

export type SandboxInstallStage =
  | 'copying_bundled_rootfs'
  | 'downloading'
  | 'extracting'
  | 'rootfs_ready'
  | 'installing_toolchain'
  | 'ready'

export interface NativeSandboxStatus {
  state: string
  installed: boolean
  toolchainReady: boolean
  androidToolchainReady: boolean
  androidToolchainSupported: boolean
  androidToolchainVariant: 'x86_64-official' | 'arm64-patched-aapt2' | 'unsupported'
  workingDirectory?: string | null
  platform: 'android-proot-alpine'
  distribution: string
  freeBytes: number
  abi: string
  error?: string
}

export type NativeSandboxJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface NativeSandboxJob {
  id: string
  state: NativeSandboxJobState
  timeoutMs: number
  createdAt: number
  updatedAt: number
  pid: number
  exitCode?: number | null
  runtimeId?: 'alpine' | 'ubuntu-24.04' | string
}

export interface NativeUbuntuStatus {
  available: boolean
  runtimeId?: 'ubuntu-24.04'
  version?: string
  installed?: boolean
  ready?: boolean
  state: 'unsupported' | 'not_downloaded' | 'queued' | 'downloading' | 'paused' | 'completed' | 'configuring' | 'ready' | 'failed'
  freeBytes?: number
  requiredFreeBytes?: number
  architecture?: 'arm64' | 'amd64'
  download?: NativeDownloadTaskSnapshot
}

interface NativeDownloadTaskSnapshot {
  id: string
  status: string
  bytesDownloaded: number
  bytesTotal: number
  bytesPerSecond: number
  error?: string
}

export interface NativeSandboxProgress {
  stage: SandboxInstallStage
  percent: number
  transferred: number
  total: number
}

interface NativeSandboxPlugin {
  checkAvailability(): Promise<{ available: boolean; reason?: string; installed: boolean; state: string }>
  status(): Promise<NativeSandboxStatus>
  install(): Promise<NativeSandboxStatus & { success: boolean }>
  pauseDownload(): Promise<{ accepted: boolean }>
  cancelDownload(): Promise<{ accepted: boolean }>
  resumeDownload(): Promise<NativeSandboxStatus & { success: boolean }>
  init(options: { workingDirectory: string }): Promise<{ success: boolean; workingDirectory?: string; error?: string }>
  exec(options: { command: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  startBackground(options: { command: string; timeout?: number }): Promise<{ accepted: boolean; jobId: string }>
  startPluginJob(options: {
    pluginId: string
    command: string
    timeout?: number
  }): Promise<{ accepted: boolean; jobId: string }>
  ubuntuStatus(): Promise<NativeUbuntuStatus>
  installUbuntu(): Promise<{ accepted: boolean; state: string; downloadId?: string; jobId?: string }>
  startUbuntuPluginJob(options: {
    pluginId: 'ubuntu-runtime'
    command: string
    timeout?: number
  }): Promise<{ accepted: boolean; jobId: string }>
  removeUbuntu(): Promise<{ success: boolean }>
  listJobs(): Promise<{ jobs: NativeSandboxJob[] }>
  queryJob(options: { jobId: string }): Promise<NativeSandboxJob>
  readJobOutput(options: { jobId: string; stdoutOffset?: number; stderrOffset?: number }): Promise<{
    stdout: string
    stderr: string
    stdoutOffset: number
    stderrOffset: number
  }>
  stopJob(options: { jobId: string }): Promise<{ accepted: boolean; jobId: string }>
  installAndroidToolchain(): Promise<{ accepted: boolean; jobId?: string; reason?: string }>
  kill(): Promise<{ killed: boolean }>
  read(options: { filePath: string }): Promise<{ success: boolean; content?: string; error?: string }>
  write(options: { filePath: string; content: string }): Promise<{ success: boolean; error?: string }>
  delete(options: { filePath: string }): Promise<{ success: boolean; error?: string }>
  readPluginFile(options: {
    pluginId: string
    filePath: string
  }): Promise<{ success: boolean; content?: string; error?: string }>
  writePluginFile(options: {
    pluginId: string
    filePath: string
    content: string
  }): Promise<{ success: boolean; error?: string }>
  cleanupPlugin(options: {
    pluginId: string
  }): Promise<{ success: boolean; stoppedJobs: number; removedWorkspace: boolean }>
  edit(options: { filePath: string; search: string; replace: string }): Promise<{ success: boolean; error?: string }>
  list(options: { dirPath: string }): Promise<{ success: boolean; content?: string; error?: string }>
  grep(options: { pattern: string; dirPath?: string; include?: string }): Promise<{
    success: boolean
    content?: string
    error?: string
  }>
  find(options: { dirPath: string; pattern?: string }): Promise<{ success: boolean; content?: string; error?: string }>
  reset(): Promise<{ success: boolean; error?: string }>
  addListener(eventName: 'progress', listener: (event: NativeSandboxProgress) => void): Promise<PluginListenerHandle>
}

export const yachiyoSandboxNative = createFeatureGatedPlugin(
  'sandbox',
  registerPlugin<NativeSandboxPlugin>('YachiyoSandbox'),
)
