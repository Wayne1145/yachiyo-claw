import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFeatureGatedPlugin,
  resetNativeFeatureGates,
  syncNativeFeatureGates,
} from './feature-gated-plugin'

describe('native feature bridge gate', () => {
  beforeEach(resetNativeFeatureGates)

  it('preserves default behavior before Settings hydration', async () => {
    const call = vi.fn(async () => ({ available: true }))
    const plugin = createFeatureGatedPlugin('sandbox', { call })
    await expect(plugin.call()).resolves.toEqual({ available: true })
    expect(call).toHaveBeenCalledOnce()
  })

  it('short-circuits disabled methods and event listeners without reaching Capacitor', async () => {
    const call = vi.fn(async () => ({ available: true }))
    const addListener = vi.fn()
    const plugin = createFeatureGatedPlugin('sandbox', { call, addListener })
    syncNativeFeatureGates(new Set(['speech']))

    await expect(plugin.call()).resolves.toEqual({ available: false, reason: 'feature_disabled' })
    const handle = await plugin.addListener()
    await expect(handle.remove()).resolves.toBeUndefined()
    expect(call).not.toHaveBeenCalled()
    expect(addListener).not.toHaveBeenCalled()
  })

  it('allows a bridge again when the feature set changes', async () => {
    const call = vi.fn(async () => 'ok')
    const plugin = createFeatureGatedPlugin('sandbox', { call })
    syncNativeFeatureGates(new Set())
    await expect(plugin.call()).resolves.toMatchObject({ reason: 'feature_disabled' })
    syncNativeFeatureGates(new Set(['sandbox']))
    await expect(plugin.call()).resolves.toBe('ok')
  })
})
