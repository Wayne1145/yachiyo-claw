export interface ElectronIPC {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  getPathForFile: (file: File) => string
  onSystemThemeChange: (callback: () => void) => () => void
  onWindowMaximizedChanged: (callback: (_: Electron.IpcRendererEvent, windowMaximized: boolean) => void) => () => void
  onWindowShow: (callback: () => void) => () => void
  onWindowFocused: (callback: () => void) => () => void
  onUpdateDownloaded: (callback: () => void) => () => void
  addMcpStdioTransportEventListener: (transportId: string, event: string, callback?: (...args: any[]) => void) => void
  onNavigate: (callback: (path: string) => void) => () => void

  // Auto-updater events
  onUpdaterChecking: (callback: () => void) => () => void
  onUpdaterAvailable: (callback: (data: { version: string }) => void) => () => void
  onUpdaterNotAvailable: (callback: () => void) => () => void
  onUpdaterProgress: (
    callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  ) => () => void
  onUpdaterDownloaded: (callback: (data: { version: string }) => void) => () => void
  onUpdaterError: (callback: (data: { message: string }) => void) => () => void
}
