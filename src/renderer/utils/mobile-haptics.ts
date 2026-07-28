import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

type HapticOperation = () => Promise<void>

async function performAndroidHaptic(operation: HapticOperation): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false
  try {
    await operation()
    return true
  } catch {
    // Haptics are enhancement-only; unsupported hardware must not block the causal UI event.
    return false
  }
}

export const flowGlassHaptics = {
  selection(): Promise<boolean> {
    return performAndroidHaptic(async () => {
      await Haptics.selectionStart()
      try {
        await Haptics.selectionChanged()
      } finally {
        await Haptics.selectionEnd()
      }
    })
  },

  lightImpact(): Promise<boolean> {
    return performAndroidHaptic(() => Haptics.impact({ style: ImpactStyle.Light }))
  },

  success(): Promise<boolean> {
    return performAndroidHaptic(() => Haptics.notification({ type: NotificationType.Success }))
  },

  error(): Promise<boolean> {
    return performAndroidHaptic(() => Haptics.notification({ type: NotificationType.Error }))
  },
}
