import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export type SandboxInstallStage =
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
  init(options: { workingDirectory: string }): Promise<{ success: boolean; workingDirectory?: string; error?: string }>
  exec(options: { command: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  startBackground(options: { command: string; timeout?: number }): Promise<{ accepted: boolean; jobId: string }>
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

export const yachiyoSandboxNative = registerPlugin<NativeSandboxPlugin>('YachiyoSandbox')
