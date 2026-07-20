import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import * as defaults from '@shared/defaults'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import { getLatestYachiyoAndroidRelease, type YachiyoAndroidRelease } from '@shared/releases/yachiyo'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import {
  executeRootShell,
  getAgentBackend,
  getAgentWorkingDirectory,
  getCachedRootCapability,
  isAgentFullAccessEnabled,
  killRootCommand,
  setAgentWorkingDirectory,
} from '@/mobile/agent-broker'
import { requestAgentApproval } from '@/mobile/agent-approval'
import { yachiyoAgentNative } from '@/platform/native/yachiyo_agent'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { yachiyoUpdateNative } from '@/platform/native/yachiyo_update'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { SessionMetaStorage } from '@/storage/SessionMetaStorage'
import { SQLiteImageGenerationStorage } from '@/storage/SQLiteImageGenerationStorage'
import { SQLiteSessionMetaStorage } from '@/storage/SQLiteSessionMetaStorage'
import { IndexedDBTaskSessionStorage, type TaskSessionStorage } from '@/storage/TaskSessionStorage'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { getBrowser, getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import { acceptMobileDeepLink, consumePendingMcpOAuthCallback } from './mobile_deep_link'
import MobileExporter from './mobile_exporter'
import mobileLogger from './mobile_logger'
import { MobileKnowledgeBaseController, MobileSessionAttachmentRagController } from './mobile-rag-controller'
import type { SessionAttachmentRagController } from './session-attachment-rag/interface'
import { MobileSQLiteStorage } from './storages'
import { parseTextFileLocally } from './web_platform_utils'

export default class MobilePlatform extends MobileSQLiteStorage implements Platform {
  public type: PlatformType = 'mobile'

  public exporter = new MobileExporter()

  private navigationCallback: ((path: string) => void) | null = null
  private pendingNavigationPath: string | null = null
  private _imageGenerationStorage: ImageGenerationStorage | null = null
  private _taskSessionStorage: TaskSessionStorage | null = null
  private _sessionMetaStorage: SessionMetaStorage | null = null
  private _mobileKnowledgeBaseController: MobileKnowledgeBaseController | null = null
  private _mobileSessionAttachmentRagController: MobileSessionAttachmentRagController | null = null
  private agentWorkingDirectory = getAgentWorkingDirectory()
  private pendingUpdate: YachiyoAndroidRelease | null = null
  private updateCheckRunning = false
  private readonly updaterCheckingListeners = new Set<() => void>()
  private readonly updaterAvailableListeners = new Set<(data: { version: string }) => void>()
  private readonly updaterNotAvailableListeners = new Set<() => void>()
  private readonly updaterProgressListeners = new Set<
    (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  >()
  private readonly updaterDownloadedListeners = new Set<(data: { version: string }) => void>()
  private readonly updaterErrorListeners = new Set<(data: { message: string }) => void>()

  constructor() {
    super()
    mobileLogger.init().catch((e) => console.error('Failed to init mobile logger:', e))
    // 监听深度链接 (Deep Links)
    App.addListener('appUrlOpen', (event) => {
      this.handleDeepLink(event.url)
    })
    if (Capacitor.isNativePlatform()) {
      void yachiyoUpdateNative.addListener('progress', (event) => {
        for (const listener of this.updaterProgressListeners) listener(event)
      })
      void yachiyoUpdateNative.addListener('downloaded', (event) => {
        for (const listener of this.updaterDownloadedListeners) listener(event)
      })
      void yachiyoUpdateNative.addListener('error', (event) => {
        for (const listener of this.updaterErrorListeners) listener(event)
      })
    }
  }

  // 处理深度链接
  private handleDeepLink(url: string): void {
    const result = acceptMobileDeepLink(url)
    if (result.kind === 'navigate') {
      this.triggerNavigation(result.path)
    } else if (result.kind === 'handled') {
      const callbackUrl = consumePendingMcpOAuthCallback()
      if (callbackUrl) {
        void import('@/packages/mcp/controller')
          .then(({ mcpController }) => mcpController.completeMobileOAuth(callbackUrl))
          .catch(() => console.warn('MCP OAuth callback could not be completed.'))
      }
    } else if (result.kind === 'rejected') {
      // Only a fixed reason code is logged; URLs can contain provider credentials.
      console.warn('Rejected mobile deep link:', result.reason)
    }
  }

  // 触发导航
  private triggerNavigation(path: string): void {
    if (this.navigationCallback) {
      this.navigationCallback(path)
    } else {
      this.pendingNavigationPath = path
      console.warn('Navigation callback not set; navigation deferred')
    }
  }

  // 设置导航回调（类似 electronAPI.onNavigate）
  public onNavigate(callback: (path: string) => void): () => void {
    this.navigationCallback = callback
    if (this.pendingNavigationPath) {
      const path = this.pendingNavigationPath
      this.pendingNavigationPath = null
      callback(path)
    }
    return () => {
      this.navigationCallback = null
    }
  }

  public async getVersion(): Promise<string> {
    return (await App.getInfo()).version
  }
  public async getPlatform(): Promise<string> {
    return CHATBOX_BUILD_PLATFORM
  }
  public async getArch(): Promise<string> {
    return 'arm64'
  }
  public async shouldUseDarkColors(): Promise<boolean> {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  public onSystemThemeChange(callback: () => void): () => void {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', callback)
    return () => {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', callback)
    }
  }
  public onWindowShow(callback: () => void): () => void {
    return () => null
  }
  public onWindowFocused(callback: () => void): () => void {
    return () => null
  }
  public onUpdateDownloaded(callback: () => void): () => void {
    const listener = () => callback()
    this.updaterDownloadedListeners.add(listener)
    return () => this.updaterDownloadedListeners.delete(listener)
  }
  public onUpdaterChecking(callback: () => void): () => void {
    this.updaterCheckingListeners.add(callback)
    return () => this.updaterCheckingListeners.delete(callback)
  }
  public onUpdaterAvailable(callback: (data: { version: string }) => void): () => void {
    this.updaterAvailableListeners.add(callback)
    return () => this.updaterAvailableListeners.delete(callback)
  }
  public onUpdaterNotAvailable(callback: () => void): () => void {
    this.updaterNotAvailableListeners.add(callback)
    return () => this.updaterNotAvailableListeners.delete(callback)
  }
  public onUpdaterProgress(
    callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void,
  ): () => void {
    this.updaterProgressListeners.add(callback)
    return () => this.updaterProgressListeners.delete(callback)
  }
  public onUpdaterDownloaded(callback: (data: { version: string }) => void): () => void {
    this.updaterDownloadedListeners.add(callback)
    return () => this.updaterDownloadedListeners.delete(callback)
  }
  public onUpdaterError(callback: (data: { message: string }) => void): () => void {
    this.updaterErrorListeners.add(callback)
    return () => this.updaterErrorListeners.delete(callback)
  }
  public async openLink(url: string): Promise<void> {
    try {
      // 使用 Browser.open 打开
      // 原生插件不受 JavaScript 用户手势限制，可以在异步调用后正常工作
      // iOS: 会使用 SFSafariViewController 而不是普通 webview
      // Android: 使用 Chrome Custom Tabs
      await Browser.open({
        url,
      })
    } catch (error) {
      console.error('Failed to open link with Browser plugin:', error)
      // 降级方案：使用 window.open（但在异步调用后可能被阻止）
      window.open(url)
    }
  }
  public async getDeviceName(): Promise<string> {
    try {
      const info = await Device.getInfo()

      // iOS: 直接返回 model 型号（如 "iPhone13,4"），官网会 mapping 成 "iPhone 13 Pro Max"
      if (info.platform === 'ios') {
        return info.model
      }

      // Android: 使用降级策略
      // 优先使用 name（用户自定义的设备名称）
      if (info.name) {
        return info.name
      }
      // 如果没有 name，返回 manufacturer + model
      if (info.manufacturer && info.model) {
        return `${info.manufacturer} ${info.model}`
      }
      // 降级到 model 或 platform
      return info.model || info.platform || getOS()
    } catch (error) {
      console.error('Failed to get device info:', error)
      // 降级方案：返回 OS 信息
      return getOS()
    }
  }
  public async getInstanceName(): Promise<string> {
    return `${getOS()} / ${getBrowser()}`
  }
  public async getLocale() {
    const lang = window.navigator.language
    return parseLocale(lang)
  }
  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    return
  }
  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    return
  }
  public async relaunch(): Promise<void> {
    location.reload()
  }

  public async getConfig(): Promise<Config> {
    let value = await this.getStoreValue('configs')
    if (value === undefined || value === null) {
      value = defaults.newConfigs()
      this.setStoreValue('configs', value)
    }
    return value
  }
  public async getSettings(): Promise<Settings> {
    let value = await this.getStoreValue('settings')
    if (value === undefined || value === null) {
      value = defaults.settings()
      this.setStoreValue('settings', value)
    }
    return value
  }

  public async getStoreBlob(key: string): Promise<string | null> {
    return localforage.getItem<string>(key)
  }
  public async setStoreBlob(key: string, value: string): Promise<void> {
    await localforage.setItem(key, value)
  }
  public async delStoreBlob(key: string) {
    return localforage.removeItem(key)
  }
  public async listStoreBlobKeys(): Promise<string[]> {
    return localforage.keys()
  }

  // Yachiyo mobile builds never send events to upstream analytics services.
  public initTracking(): void {}
  public trackingEvent(_name: string, _params: { [key: string]: string }): void {}

  public async appLog(level: string, message: string): Promise<void> {
    mobileLogger.log(level, message)
  }

  public async exportLogs(): Promise<string> {
    return mobileLogger.exportLogs()
  }

  public async clearLogs(): Promise<void> {
    return mobileLogger.clearLogs()
  }

  public async ensureAutoLaunch(enable: boolean) {
    return
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    const result = await parseTextFileLocally(file)
    if (!result.isSupported) {
      return { isSupported: false }
    }
    const key = `parseFile-${uuidv4()}`
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  getLocalFilePath(file: File): string {
    return file.path || ''
  }

  public async parseUrl(url: string): Promise<{ key: string; title: string }> {
    throw new Error('Not implemented')
  }

  public async isFullscreen() {
    return true
  }

  public async setFullscreen(enabled: boolean): Promise<void> {
    return
  }

  public async checkForUpdate(): Promise<{ started: boolean }> {
    if (this.updateCheckRunning) return { started: false }
    this.updateCheckRunning = true
    for (const listener of this.updaterCheckingListeners) listener()
    try {
      this.pendingUpdate = await getLatestYachiyoAndroidRelease(await this.getVersion())
      if (!this.pendingUpdate) {
        for (const listener of this.updaterNotAvailableListeners) listener()
      } else {
        for (const listener of this.updaterAvailableListeners) listener({ version: this.pendingUpdate.version })
      }
      return { started: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'update_check_failed'
      for (const listener of this.updaterErrorListeners) listener({ message })
      throw error
    } finally {
      this.updateCheckRunning = false
    }
  }

  public async downloadUpdate(): Promise<void> {
    const update = this.pendingUpdate
    if (!update) throw new Error('update_metadata_missing')
    await yachiyoUpdateNative.downloadUpdate({
      version: update.version,
      url: update.apk.url,
      size: update.apk.size,
      sha256: update.apk.sha256,
      sha256SidecarUrl: update.apk.sha256SidecarUrl,
    })
  }

  public async openUpdateInstallPermissionSettings(): Promise<void> {
    await yachiyoUpdateNative.openInstallPermissionSettings()
  }

  public async installUpdate(): Promise<void> {
    const result = await yachiyoUpdateNative.installUpdate()
    if (result.permissionRequired) throw new Error('install_permission_required')
  }

  public getKnowledgeBaseController(): KnowledgeBaseController {
    if (!this._mobileKnowledgeBaseController) {
      this._mobileKnowledgeBaseController = new MobileKnowledgeBaseController(this)
    }
    return this._mobileKnowledgeBaseController
  }

  public getSessionAttachmentRagController(): SessionAttachmentRagController {
    if (!this._mobileSessionAttachmentRagController) {
      this._mobileSessionAttachmentRagController = new MobileSessionAttachmentRagController(this)
    }
    return this._mobileSessionAttachmentRagController
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    if (!this._imageGenerationStorage) {
      this._imageGenerationStorage = new SQLiteImageGenerationStorage()
    }
    return this._imageGenerationStorage
  }

  public getTaskSessionStorage(): TaskSessionStorage {
    if (!this._taskSessionStorage) {
      this._taskSessionStorage = new IndexedDBTaskSessionStorage()
    }
    return this._taskSessionStorage
  }

  public getSessionMetaStorage(): SessionMetaStorage {
    if (!this._sessionMetaStorage) {
      this._sessionMetaStorage = new SQLiteSessionMetaStorage()
    }
    return this._sessionMetaStorage
  }

  public async sandboxInit(config: { workingDirectory: string }) {
    this.agentWorkingDirectory = config.workingDirectory
    if (!isAgentFullAccessEnabled()) return { success: true }
    if (getAgentBackend() === 'accessibility') return { success: true }
    const result = await executeRootShell(`mkdir -p ${shellQuote(this.agentWorkingDirectory)}`, 10_000)
    return result.exitCode === 0 ? { success: true } : { success: false, error: result.stderr }
  }

  public async sandboxExec(params: { command: string; timeout?: number }) {
    const approved = await requestAgentApproval({
      title: '执行 Shell 命令',
      detail: params.command,
      risk: 'dangerous',
    })
    if (!approved) return { stdout: '', stderr: '用户拒绝了此操作', exitCode: 126 }
    const result = await executeRootShell(
      `cd ${shellQuote(this.agentWorkingDirectory)} && ${params.command}`,
      params.timeout ?? 120_000,
    )
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
  }

  public async sandboxKill() {
    return killRootCommand()
  }

  public async sandboxCheckAvailability() {
    if (!isAgentFullAccessEnabled()) {
      return { available: false, reason: 'full_access_required' }
    }
    const backend = getAgentBackend()
    if (backend === 'accessibility') {
      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      return {
        available: permissions.accessibility,
        reason: permissions.accessibility ? undefined : 'accessibility_unavailable',
      }
    }
    if (backend === 'shizuku') {
      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      return {
        available: permissions.shizukuGranted,
        reason: permissions.shizukuGranted ? undefined : 'shizuku_unavailable',
      }
    }
    const root = getCachedRootCapability()
    return { available: Boolean(root?.available), reason: root?.available ? undefined : 'root_check_required' }
  }

  public async sandboxStatus() {
    const availability = await this.sandboxCheckAvailability()
    return {
      state: availability.available ? 'ready' : 'unavailable',
      workingDirectory: this.agentWorkingDirectory,
      platform: `android-${getAgentBackend()}`,
    }
  }

  public async openDirectoryDialog(): Promise<{ canceled: boolean; path?: string }> {
    const result = await yachiyoAgentNative.pickWorkingDirectory()
    if (!result.canceled && result.path) {
      setAgentWorkingDirectory(result.path)
      this.agentWorkingDirectory = result.path
    }
    return { canceled: result.canceled, path: result.path }
  }

  public minimize() {
    return Promise.resolve()
  }

  public maximize() {
    return Promise.resolve()
  }

  public unmaximize() {
    return Promise.resolve()
  }

  public closeWindow() {
    return Promise.resolve()
  }

  public isMaximized() {
    return Promise.resolve(true)
  }

  public onMaximizedChange() {
    return () => null
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
