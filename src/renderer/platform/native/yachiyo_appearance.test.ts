import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncAndroidSystemBars } from './yachiyo_appearance'

const bridgeState = vi.hoisted(() => ({
  platform: 'android',
  native: true,
  plugin: {
    setSystemBars: vi.fn(),
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
    })
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
    })
    expect(bridgeState.plugin.setSystemBars).not.toHaveBeenCalled()
  })

  it('rejects unsupported navigation color syntax before crossing the bridge', async () => {
    await expect(
      syncAndroidSystemBars({ scheme: 'light', navigationBarColor: 'rgba(255, 255, 255, .5)' })
    ).rejects.toThrow('CSS #RRGGBB or #RRGGBBAA')
  })
})
