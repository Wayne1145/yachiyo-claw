import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAndroidInteractionState,
  onAndroidInteractionStateChanged,
  syncAndroidSystemBars,
} from './yachiyo_appearance'

const bridgeState = vi.hoisted(() => ({
  platform: 'android',
  native: true,
  plugin: {
    setSystemBars: vi.fn(),
    getInteractionState: vi.fn(),
    addListener: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => bridgeState.platform),
    isNativePlatform: vi.fn(() => bridgeState.native),
  },
  registerPlugin: vi.fn(() => bridgeState.plugin),
}))

describe('YachiyoAppearance bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeState.platform = 'android'
    bridgeState.native = true
    bridgeState.plugin.setSystemBars.mockResolvedValue({
      applied: true,
      edgeToEdge: true,
      navigationMode: 'gesture',
      systemGestureInsetsCssPx: { left: 18, right: 18 },
      touchExplorationEnabled: false,
    })
    bridgeState.plugin.getInteractionState.mockResolvedValue({
      navigationMode: 'gesture',
      systemGestureInsetsCssPx: { left: 18, right: 18 },
      touchExplorationEnabled: false,
    })
    bridgeState.plugin.addListener.mockResolvedValue({ remove: vi.fn() })
  })

  it('sends the scheme and a conservative three-button fallback color', async () => {
    await syncAndroidSystemBars({ scheme: 'dark' })
    expect(bridgeState.plugin.setSystemBars).toHaveBeenCalledWith({
      scheme: 'dark',
      navigationBarColor: '#15191FF2',
    })
  })

  it('preserves an explicitly supplied CSS RGBA color', async () => {
    await syncAndroidSystemBars({ scheme: 'light', navigationBarColor: '#EAF4FFCC' })
    expect(bridgeState.plugin.setSystemBars).toHaveBeenCalledWith({
      scheme: 'light',
      navigationBarColor: '#EAF4FFCC',
    })
  })

  it('does not invoke the Android plugin in web builds', async () => {
    bridgeState.native = false
    await expect(syncAndroidSystemBars({ scheme: 'light' })).resolves.toEqual({
      applied: false,
      edgeToEdge: false,
      navigationMode: 'not-android',
      systemGestureInsetsCssPx: { left: 0, right: 0 },
      touchExplorationEnabled: false,
    })
    expect(bridgeState.plugin.setSystemBars).not.toHaveBeenCalled()
  })

  it('reads the current Android interaction state', async () => {
    await expect(getAndroidInteractionState()).resolves.toEqual({
      navigationMode: 'gesture',
      systemGestureInsetsCssPx: { left: 18, right: 18 },
      touchExplorationEnabled: false,
    })
    expect(bridgeState.plugin.getInteractionState).toHaveBeenCalledOnce()
  })

  it('subscribes to typed interaction state changes on Android', async () => {
    const listener = vi.fn()
    await onAndroidInteractionStateChanged(listener)
    expect(bridgeState.plugin.addListener).toHaveBeenCalledWith('interactionStateChanged', listener)
  })

  it('uses a removable no-op interaction subscription outside Android', async () => {
    bridgeState.platform = 'web'
    bridgeState.native = false
    const handle = await onAndroidInteractionStateChanged(vi.fn())
    await expect(handle.remove()).resolves.toBeUndefined()
    expect(bridgeState.plugin.addListener).not.toHaveBeenCalled()
    await expect(getAndroidInteractionState()).resolves.toEqual({
      navigationMode: 'not-android',
      systemGestureInsetsCssPx: { left: 0, right: 0 },
      touchExplorationEnabled: false,
    })
  })

  it('rejects unsupported navigation color syntax before crossing the bridge', async () => {
    await expect(
      syncAndroidSystemBars({ scheme: 'light', navigationBarColor: 'rgba(255, 255, 255, .5)' }),
    ).rejects.toThrow('CSS #RRGGBB or #RRGGBBAA')
  })
})
