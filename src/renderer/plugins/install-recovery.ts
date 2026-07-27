import { Capacitor } from '@capacitor/core'
import { readCompletedDownload, yachiyoDownloadsNative } from '@/platform/native/yachiyo_downloads'
import { usePluginStore } from './plugin-manager'
import {
  clearPendingPluginInstall,
  discardPendingPluginArtifact,
  markPendingPluginInstallEnqueued,
  readPendingPluginInstall,
} from './pending-install'

export type PluginInstallRecoveryResult = 'none' | 'waiting' | 'restored' | 'failed'

/** Rehydrates a downloaded package into the normal verification and user-consent flow. */
/** 将已下载的安装包恢复到常规校验与用户确认流程。 */
export async function resumePendingPluginInstall(): Promise<PluginInstallRecoveryResult> {
  if (!Capacitor.isNativePlatform()) return 'none'
  const pending = readPendingPluginInstall()
  if (!pending) return 'none'
  if (usePluginStore.getState().pendingConsent) return 'restored'
  const tasks = (await yachiyoDownloadsNative.list()).tasks
  const task = tasks.find((entry) => entry.id === pending.request.id)
  if (!task) {
    if (pending.state === 'enqueued') {
      clearPendingPluginInstall(pending.request.id)
      return 'failed'
    }
    await yachiyoDownloadsNative.enqueue(pending.request)
    markPendingPluginInstallEnqueued(pending.request.id)
    return 'waiting'
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    clearPendingPluginInstall(pending.request.id)
    return 'failed'
  }
  if (task.status !== 'completed') return 'waiting'

  try {
    const bytes = await readCompletedDownload(pending.request.id)
    await usePluginStore.getState().requestInstall(bytes, pending.source, {
      ...(pending.expectedSha256 ? { expectedSha256: pending.expectedSha256 } : {}),
      ...(pending.signature ? { signature: pending.signature } : {}),
      ...(pending.updateSource ? { updateSource: pending.updateSource } : {}),
      ...(pending.expectedPlugin ? { expectedPlugin: pending.expectedPlugin } : {}),
      artifactId: pending.request.id,
    })
    const manifest = usePluginStore.getState().pendingConsent?.verified.manifest
    if (
      pending.expectedPlugin &&
      (!manifest || manifest.id !== pending.expectedPlugin.id || manifest.version !== pending.expectedPlugin.version)
    ) {
      await usePluginStore.getState().cancelInstall()
      throw new Error('plugin_marketplace_identity_mismatch')
    }
    return 'restored'
  } catch (error) {
    clearPendingPluginInstall(pending.request.id)
    await discardPendingPluginArtifact(pending.request.id)
    throw error
  }
}

let recoveryTimer: number | undefined
let recoveryRunning = false

export function startPendingPluginInstallRecovery(onRestored: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const run = async () => {
    if (recoveryRunning) return
    recoveryRunning = true
    try {
      const result = await resumePendingPluginInstall()
      if (result === 'restored') {
        if (recoveryTimer !== undefined) window.clearInterval(recoveryTimer)
        recoveryTimer = undefined
        onRestored()
      }
    } finally {
      recoveryRunning = false
    }
  }
  void run().catch(() => undefined)
  recoveryTimer ??= window.setInterval(() => void run().catch(() => undefined), 2_000)
  return () => {
    if (recoveryTimer !== undefined) window.clearInterval(recoveryTimer)
    recoveryTimer = undefined
  }
}
