import { create } from 'zustand'
import { t } from 'i18next'
import platform from '@/platform'

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
  error: null,
  dismissedVersion: null,

  dismiss() {
    set({ dismissedVersion: get().version })
  },
}))

export async function requestInstallUpdate() {
  try {
    await platform.installUpdate()
  } catch (error) {
    if (error instanceof Error && error.message === 'install_permission_required') {
      useUpdateStore.setState({ status: 'permission-required', error: null })
      return
    }
    useUpdateStore.setState({ status: 'error', error: t('Update failed') })
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
  } catch (error) {
    const message = error instanceof Error ? error.message : t('Update failed')
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

/** Legacy desktop entrypoint retained for existing callers. */
export function installUpdate() {
  void requestInstallUpdate()
}

let initialized = false

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
      const { dismissedVersion } = useUpdateStore.getState()
      useUpdateStore.setState({
        status: 'downloaded',
        version: data.version,
        progress: 100,
        dismissedVersion: dismissedVersion === data.version ? dismissedVersion : null,
      })
    })
  }

  if (platform.onUpdaterError) {
    platform.onUpdaterError((data) => {
      useUpdateStore.setState({ status: 'error', error: data.message, progress: 0 })
    })
  }
}
