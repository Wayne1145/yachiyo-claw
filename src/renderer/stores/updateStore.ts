import { create } from 'zustand'
import { t } from 'i18next'
import platform from '@/platform'

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'

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

export function installUpdate() {
  platform.installUpdate().catch(() => {
    useUpdateStore.setState({ status: 'error', error: t('Update failed') })
  })
}

let initialized = false

/**
 * Initialize update event listeners (desktop only).
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
