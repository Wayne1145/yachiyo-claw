/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInsets: vi.fn(),
  native: new Map<string, (value?: unknown) => void>(),
  windowEvents: new Map<string, () => void>(),
}))
vi.mock('capacitor-plugin-safe-area', () => ({
  SafeArea: {
    getSafeAreaInsets: mocks.getInsets,
    addListener: async (name: string, callback: () => void) => {
      mocks.native.set(name, callback)
    },
  },
}))
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: async (name: string, callback: () => void) => {
      mocks.native.set(name, callback)
    },
  },
}))

const portrait = { insets: { top: 49, left: 0, right: 0, bottom: 24 } }
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
beforeEach(() => {
  vi.resetModules()
  mocks.getInsets.mockReset().mockResolvedValue(portrait)
  mocks.native.clear()
  mocks.windowEvents.clear()
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.yachiyoKeyboard
  vi.stubGlobal('window', {
    addEventListener: (name: string, callback: () => void) => mocks.windowEvents.set(name, callback),
    requestAnimationFrame: (callback: (time: number) => void) => {
      queueMicrotask(() => callback(0))
      return 1
    },
    cancelAnimationFrame: vi.fn(),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('mobile safe-area refresh', () => {
  it('does not let a late landscape query overwrite the current portrait insets', async () => {
    await import('./mobile_safe_area')
    let completeOld!: (value: typeof portrait) => void
    mocks.getInsets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve
        })
    )
    mocks.windowEvents.get('orientationchange')?.()
    await flush()
    mocks.native.get('safeAreaChanged')?.({ insets: { top: 24, left: 65, right: 0, bottom: 0 } })
    await flush()
    completeOld({ insets: { top: 24, left: 65, right: 0, bottom: 0 } })
    await flush()
    expect(document.documentElement.style.getPropertyValue('--mobile-safe-area-inset-left')).toBe('0px')
    expect(document.documentElement.style.getPropertyValue('--mobile-safe-area-inset-top')).toBe('49px')
  })

  it('keeps the keyboard bottom inset zero across refreshes, then restores navigation clearance', async () => {
    await import('./mobile_safe_area')
    mocks.native.get('keyboardWillShow')?.()
    await flush()
    mocks.windowEvents.get('resize')?.()
    await flush()
    expect(document.documentElement.dataset.yachiyoKeyboard).toBe('open')
    expect(document.documentElement.style.getPropertyValue('--mobile-safe-area-inset-bottom')).toBe('0px')
    mocks.native.get('keyboardWillHide')?.()
    await flush()
    expect(document.documentElement.dataset.yachiyoKeyboard).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--mobile-safe-area-inset-bottom')).toBe('24px')
  })
})
