import { describe, expect, it } from 'vitest'
import {
  canGrantPluginDeviceCapability,
  isPluginCapabilityImplemented,
  PLUGIN_DEVICE_CAPABILITY_AVAILABLE,
  PLUGIN_SANDBOX_CAPABILITY_AVAILABLE,
} from './device-policy'

describe('third-party plugin device policy', () => {
  it('opens device only to verified packages and exposes the Broker-backed sandbox', () => {
    expect(PLUGIN_DEVICE_CAPABILITY_AVAILABLE).toBe(true)
    expect(PLUGIN_SANDBOX_CAPABILITY_AVAILABLE).toBe(true)
    expect(canGrantPluginDeviceCapability(true)).toBe(true)
    expect(canGrantPluginDeviceCapability(false)).toBe(false)
    expect(isPluginCapabilityImplemented('device')).toBe(true)
    expect(isPluginCapabilityImplemented('sandbox')).toBe(true)
    expect(isPluginCapabilityImplemented('network')).toBe(true)
  })
})
