import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flowGlassHaptics } from './mobile-haptics'

const hapticState = vi.hoisted(() => ({
  platform: 'android',
  native: true,
  impact: vi.fn(),
  notification: vi.fn(),
  selectionChanged: vi.fn(),
  selectionEnd: vi.fn(),
  selectionStart: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => hapticState.platform),
    isNativePlatform: vi.fn(() => hapticState.native),
  },
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: hapticState.impact,
    notification: hapticState.notification,
    selectionChanged: hapticState.selectionChanged,
    selectionEnd: hapticState.selectionEnd,
    selectionStart: hapticState.selectionStart,
  },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Error: 'ERROR', Success: 'SUCCESS' },
}))

describe('Flow Glass haptics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hapticState.platform = 'android'
    hapticState.native = true
    hapticState.impact.mockResolvedValue(undefined)
    hapticState.notification.mockResolvedValue(undefined)
    hapticState.selectionChanged.mockResolvedValue(undefined)
    hapticState.selectionEnd.mockResolvedValue(undefined)
    hapticState.selectionStart.mockResolvedValue(undefined)
  })

  it('maps selection and light-impact events to the official Capacitor plugin', async () => {
    await expect(flowGlassHaptics.selection()).resolves.toBe(true)
    await expect(flowGlassHaptics.lightImpact()).resolves.toBe(true)
    expect(hapticState.selectionChanged).toHaveBeenCalledOnce()
    expect(hapticState.selectionStart).toHaveBeenCalledBefore(hapticState.selectionChanged)
    expect(hapticState.selectionChanged).toHaveBeenCalledBefore(hapticState.selectionEnd)
    expect(hapticState.impact).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('keeps completion feedback semantically distinct', async () => {
    await flowGlassHaptics.success()
    await flowGlassHaptics.error()
    expect(hapticState.notification).toHaveBeenNthCalledWith(1, { type: 'SUCCESS' })
    expect(hapticState.notification).toHaveBeenNthCalledWith(2, { type: 'ERROR' })
  })

  it('skips non-Android runtimes and treats unsupported hardware as non-fatal', async () => {
    hapticState.native = false
    await expect(flowGlassHaptics.selection()).resolves.toBe(false)
    expect(hapticState.selectionChanged).not.toHaveBeenCalled()

    hapticState.native = true
    hapticState.impact.mockRejectedValue(new Error('unavailable'))
    await expect(flowGlassHaptics.lightImpact()).resolves.toBe(false)
  })
})
