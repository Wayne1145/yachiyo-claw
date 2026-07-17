import { describe, expect, it } from 'vitest'
import type { DevicePermissionStatus } from '@/platform/native/yachiyo_device_access'
import { hasAgentAccessBackend, shouldOpenPermissionWizard } from './device-permissions'

const permissions = (patch: Partial<DevicePermissionStatus> = {}): DevicePermissionStatus => ({
  overlay: true,
  batteryOptimizationIgnored: true,
  allFiles: false,
  accessibility: false,
  shizukuInstalled: true,
  shizukuRunning: true,
  shizukuGranted: false,
  ...patch,
})

describe('Android permission guidance', () => {
  it('accepts Root, Shizuku, or accessibility as the device backend', () => {
    expect(hasAgentAccessBackend(permissions(), true)).toBe(true)
    expect(hasAgentAccessBackend(permissions({ shizukuGranted: true }), false)).toBe(true)
    expect(hasAgentAccessBackend(permissions({ accessibility: true }), false)).toBe(true)
  })

  it('prompts for missing required access but respects defer for this app session', () => {
    expect(shouldOpenPermissionWizard(permissions(), false, false)).toBe(true)
    expect(shouldOpenPermissionWizard(permissions(), false, true)).toBe(false)
  })

  it('does not require optional all-files access', () => {
    expect(shouldOpenPermissionWizard(permissions({ shizukuGranted: true, allFiles: false }), false, false)).toBe(false)
  })
})
