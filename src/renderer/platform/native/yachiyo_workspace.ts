import { registerPlugin } from '@capacitor/core'

export interface ExternalWorkspaceInfo {
  available?: boolean
  canceled?: boolean
  uri?: string
  workspaceKey?: string
  displayName?: string
  internalPath?: string
  canRead?: boolean
  canWrite?: boolean
  error?: string
}

export interface WorkspaceOperationResult {
  success: boolean
  error?: string
  files?: number
  bytes?: number
  workspaceKey?: string
  id?: string
  url?: string
  uri?: string
  name?: string
  shared?: boolean
}

export interface BrowserOperationResult {
  success: boolean
  error?: string
  value?: string
  mimeType?: string
  base64?: string
  url?: string
}

interface YachiyoWorkspaceNative {
  pickExternalWorkspace(): Promise<ExternalWorkspaceInfo>
  getExternalWorkspace(): Promise<ExternalWorkspaceInfo>
  syncFromExternal(): Promise<WorkspaceOperationResult>
  syncToExternal(): Promise<WorkspaceOperationResult>
  exportZip(options: { name?: string; share?: boolean }): Promise<WorkspaceOperationResult>
  registerPreview(options: { port: number; path?: string }): Promise<WorkspaceOperationResult>
  openPreview(options: { id: string }): Promise<WorkspaceOperationResult>
  browserNavigate(options: { url: string }): Promise<BrowserOperationResult>
  browserClick(options: { selector: string }): Promise<BrowserOperationResult>
  browserType(options: { selector: string; text: string }): Promise<BrowserOperationResult>
  browserSnapshot(): Promise<BrowserOperationResult>
  browserScreenshot(): Promise<BrowserOperationResult>
}

export const yachiyoWorkspaceNative = registerPlugin<YachiyoWorkspaceNative>('YachiyoWorkspace')

export function parseBrowserEvaluation(value?: string): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
