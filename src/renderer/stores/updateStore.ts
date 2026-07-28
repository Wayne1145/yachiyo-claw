import { create } from 'zustand'
import { t } from 'i18next'
import platform from '@/platform'
import type { NativeUpdateDownloadStatus } from '@/platform/native/yachiyo_update'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'permission-required'
  | 'error'

interface UpdateState {
  status: UpdateStatus
  progress: number
  version: string | null
  notes: string
  releaseUrl: string | null
  error: string | null
  dismissedVersion: string | null
}

interface UpdateActions {
  dismiss(): void
}

export const useUpdateStore = create<UpdateState & UpdateActions>((set, get) => ({
  status: 'idle',
  progress: 0,
  version: null,
  notes: '',
  releaseUrl: null,
  error: null,
  dismissedVersion: null,

  dismiss() {
    set({ dismissedVersion: get().version })
  },
}))

const UPDATE_ERROR_KEYS: Record<string, string> = {
  update_version_not_newer: '更新包版本不高于当前版本，已清理旧安装包。',
  update_signature_mismatch: '更新包签名与当前应用不一致，安装已阻止。',
  update_package_invalid: '更新包不是有效的 Yachiyo Claw 安装包。',
  update_digest_mismatch: '更新包完整性校验失败，请重新下载。',
  verified_update_missing: '已下载的更新包不存在或已失效，请重新下载。',
  update_storage_unavailable: '无法写入更新包，请检查设备剩余空间。',
  update_install_failed: '无法启动 Android 安装程序，请检查安装权限后重试。',
  update_download_failed: '更新下载失败，请检查网络或镜像设置后重试。',
  update_metadata_missing: '更新下载信息已失效，请重新检查更新。',
}

export function humanizeUpdateError(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const key = UPDATE_ERROR_KEYS[code] || '更新操作失败，请稍后重试。'
  const translated = t(key)
  return typeof translated === 'string' && translated ? translated : key
}

export async function requestInstallUpdate() {
  try {
    await platform.installUpdate()
  } catch (error) {
    if (error instanceof Error && error.message === 'install_permission_required') {
      useUpdateStore.setState({ status: 'permission-required', error: null })
      return
    }
    useUpdateStore.setState({ status: 'error', error: humanizeUpdateError(error) })
  }
}

export async function openUpdateInstallPermissionSettings() {
  try {
    await platform.openUpdateInstallPermissionSettings?.()
    useUpdateStore.setState({ status: 'downloaded', error: null })
  } catch {
    useUpdateStore.setState({ status: 'error', error: t('Update failed') })
  }
}

export async function downloadUpdate() {
  useUpdateStore.setState({ status: 'downloading', progress: 0, error: null })
  try {
    await platform.downloadUpdate?.()
    startUpdateDownloadMonitor()
  } catch (error) {
    const message = humanizeUpdateError(error)
    useUpdateStore.setState({ status: 'error', error: message, progress: 0 })
  }
}

export async function checkForUpdates() {
  useUpdateStore.setState({ status: 'checking', error: null })
  try {
    const result = await platform.checkForUpdate?.()
    if (result && !result.started && useUpdateStore.getState().status === 'checking') {
      useUpdateStore.setState({ status: 'idle' })
    }
  } catch {
    if (useUpdateStore.getState().status === 'checking') {
      useUpdateStore.setState({ status: 'error', error: t('Failed to check for updates') })
    }
  }
}

let startupTimer: ReturnType<typeof setTimeout> | undefined

export function scheduleStartupUpdateCheck(enabled: boolean, delay = 3_000) {
  if (!enabled || platform.type !== 'mobile' || startupTimer) return
  startupTimer = setTimeout(() => {
    startupTimer = undefined
    void checkForUpdates()
  }, delay)
}

export function cancelStartupUpdateCheck() {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = undefined
  }
}

/** Allows Settings > About to reopen an update dismissed during startup. */
export function reopenUpdateDialog() {
  const state = useUpdateStore.getState()
  if (state.version && state.status !== 'idle') useUpdateStore.setState({ dismissedVersion: null })
}

/** Legacy desktop entrypoint retained for existing callers. */
export function installUpdate() {
  void requestInstallUpdate()
}

let initialized = false
let downloadMonitorTimer: ReturnType<typeof setTimeout> | undefined

function stopUpdateDownloadMonitor() {
  if (downloadMonitorTimer) clearTimeout(downloadMonitorTimer)
  downloadMonitorTimer = undefined
}

export function applyNativeUpdateDownloadStatus(result: NativeUpdateDownloadStatus): boolean {
  const version = result.version || useUpdateStore.getState().version
  if (result.ready) {
    useUpdateStore.setState({
      status: 'downloaded',
      version,
      progress: 100,
      error: null,
      dismissedVersion: null,
    })
    return false
  }
  if (result.status === 'queued' || result.status === 'downloading') {
    useUpdateStore.setState({
      status: 'downloading',
      version,
      progress: Math.max(0, Math.min(100, result.progress || 0)),
      error: null,
    })
    return true
  }
  if (result.status === 'paused') {
    useUpdateStore.setState({ status: 'available', version, progress: result.progress || 0, error: null })
    return false
  }
  if (result.status === 'failed') {
    useUpdateStore.setState({
      status: 'error',
      version,
      progress: result.progress || 0,
      error: humanizeUpdateError(result.error || 'update_download_failed'),
    })
    return false
  }
  if (result.status === 'cancelled') {
    useUpdateStore.setState({ status: 'idle', progress: 0, error: null, dismissedVersion: version })
    return false
  }
  if (result.status === 'completed') {
    useUpdateStore.setState({ status: 'error', version, progress: 100, error: t('更新包校验失败，请重新下载。') })
    return false
  }
  if (result.status === 'idle') {
    useUpdateStore.setState({
      status: 'idle',
      version: null,
      progress: 0,
      error: null,
      dismissedVersion: null,
    })
  }
  return false
}

async function pollUpdateDownload() {
  downloadMonitorTimer = undefined
  if (platform.type !== 'mobile' || !platform.getUpdateDownloadStatus) return
  try {
    const keepPolling = applyNativeUpdateDownloadStatus(await platform.getUpdateDownloadStatus())
    if (keepPolling) downloadMonitorTimer = setTimeout(() => void pollUpdateDownload(), 1_000)
  } catch {
    downloadMonitorTimer = setTimeout(() => void pollUpdateDownload(), 2_000)
  }
}

export function startUpdateDownloadMonitor() {
  if (downloadMonitorTimer || platform.type !== 'mobile') return
  downloadMonitorTimer = setTimeout(() => void pollUpdateDownload(), 250)
}

/**
 * Initialize update event listeners for desktop and Android.
 * Idempotent — safe to call multiple times (e.g., during hot reload).
 */
export function initUpdateListeners() {
  if (initialized) return
  initialized = true

  if (platform.onUpdaterChecking) {
    platform.onUpdaterChecking(() => {
      useUpdateStore.setState({ status: 'checking', error: null })
    })
  }

  if (platform.onUpdaterAvailable) {
    platform.onUpdaterAvailable((data) => {
      const { dismissedVersion } = useUpdateStore.getState()
      useUpdateStore.setState({
        status: 'available',
        version: data.version,
        notes: data.notes || '',
        releaseUrl: data.releaseUrl || null,
        dismissedVersion: dismissedVersion === data.version ? dismissedVersion : null,
      })
    })
  }

  if (platform.onUpdaterNotAvailable) {
    platform.onUpdaterNotAvailable(() => {
      const { status } = useUpdateStore.getState()
      if (status === 'checking') {
        useUpdateStore.setState({ status: 'up-to-date' })
        setTimeout(() => {
          if (useUpdateStore.getState().status === 'up-to-date') {
            useUpdateStore.setState({ status: 'idle' })
          }
        }, 3_000)
      } else if (status !== 'idle') {
        useUpdateStore.setState({ status: 'idle' })
      }
    })
  }

  if (platform.onUpdaterProgress) {
    platform.onUpdaterProgress((data) => {
      const { progress, status } = useUpdateStore.getState()
      if (status === 'downloading' && progress === data.percent) return
      useUpdateStore.setState({ status: 'downloading', progress: data.percent })
    })
  }

  if (platform.onUpdaterDownloaded) {
    platform.onUpdaterDownloaded((data) => {
      // A finished download always re-surfaces the install prompt, even if the dialog was dismissed earlier.
      useUpdateStore.setState({
        status: 'downloaded',
        version: data.version,
        progress: 100,
        dismissedVersion: null,
      })
    })
  }

  if (platform.onUpdaterError) {
    platform.onUpdaterError((data) => {
      stopUpdateDownloadMonitor()
      useUpdateStore.setState({ status: 'error', error: data.message, progress: 0 })
    })
  }

  void restorePendingInstall()
}

/**
 * On startup, restore the install prompt when a verified APK from a previous session is already on disk
 * (e.g. the download finished after the user closed the app).
 */
export async function restorePendingInstall() {
  if (platform.type !== 'mobile' || !platform.getUpdateDownloadStatus) return
  try {
    const result = await platform.getUpdateDownloadStatus()
    if (applyNativeUpdateDownloadStatus(result)) startUpdateDownloadMonitor()
  } catch {
    // A missing or unverifiable file simply leaves the updater idle.
  }
}
