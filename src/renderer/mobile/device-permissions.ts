import type { DevicePermissionStatus } from '@/platform/native/yachiyo_device_access'

export function hasAgentAccessBackend(status: DevicePermissionStatus, rootAvailable: boolean): boolean {
  return rootAvailable || status.shizukuGranted || status.accessibility
}

export function shouldOpenPermissionWizard(
  status: DevicePermissionStatus,
  rootAvailable: boolean,
  deferredForSession: boolean
): boolean {
  if (deferredForSession) return false
  return !status.overlay || !status.batteryOptimizationIgnored || !hasAgentAccessBackend(status, rootAvailable)
}
