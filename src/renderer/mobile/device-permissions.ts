import type { DevicePermissionStatus } from '@/platform/native/yachiyo_device_access'

export function hasAgentAccessBackend(status: DevicePermissionStatus, rootAvailable: boolean): boolean {
  return rootAvailable || status.shizukuGranted || status.accessibility
}

export function shouldOpenPermissionWizard(status: DevicePermissionStatus, deferredForSession: boolean): boolean {
  if (deferredForSession) return false
  return !status.notificationsGranted || !status.batteryOptimizationIgnored
}
