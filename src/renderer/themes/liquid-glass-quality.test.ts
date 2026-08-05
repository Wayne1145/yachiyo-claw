/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLiquidGlassQuality,
  LIQUID_GLASS_QUALITY_STORAGE_KEY,
  LIQUID_GLASS_RESOLVED_QUALITY_STORAGE_KEY,
  observeLiquidGlassQuality,
  type LiquidGlassCapabilities,
  resolveLiquidGlassQuality,
} from './liquid-glass-quality'

const capable: LiquidGlassCapabilities = {
  supportsBackdropFilter: true,
  supportsSvgDisplacement: true,
  prefersReducedMotion: false,
  prefersReducedTransparency: false,
  prefersHighContrast: false,
  forcedColors: false,
  saveData: false,
  androidMajorVersion: 15,
  deviceMemoryGb: 8,
  hardwareConcurrency: 8,
}

describe('Liquid Glass quality', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.yachiyoLiquidGlassQuality
    delete document.documentElement.dataset.yachiyoLiquidGlassQualityPreference
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('honors explicit quality choices on capable devices', () => {
    expect(resolveLiquidGlassQuality('full', capable)).toBe('full')
    expect(resolveLiquidGlassQuality('balanced', capable)).toBe('balanced')
    expect(resolveLiquidGlassQuality('reduced', capable)).toBe('reduced')
  })

  it('uses capability hints for automatic quality', () => {
    expect(resolveLiquidGlassQuality('auto', capable)).toBe('balanced')
    expect(resolveLiquidGlassQuality('auto', { ...capable, hardwareConcurrency: 6 })).toBe('balanced')
    expect(resolveLiquidGlassQuality('auto', { ...capable, androidMajorVersion: 12 })).toBe('balanced')
    expect(resolveLiquidGlassQuality('auto', { ...capable, deviceMemoryGb: 2 })).toBe('reduced')
  })

  it('always reduces transparency when the platform or user requires it', () => {
    expect(resolveLiquidGlassQuality('full', { ...capable, supportsBackdropFilter: false })).toBe('reduced')
    expect(resolveLiquidGlassQuality('full', { ...capable, prefersReducedTransparency: true })).toBe('reduced')
    expect(resolveLiquidGlassQuality('full', { ...capable, supportsSvgDisplacement: false })).toBe('balanced')
    expect(resolveLiquidGlassQuality('auto', { ...capable, forcedColors: true })).toBe('reduced')
  })

  it('mirrors requested and resolved quality for first-paint attributes', () => {
    expect(applyLiquidGlassQuality('auto', capable)).toBe('balanced')
    expect(document.documentElement.dataset.yachiyoLiquidGlassQualityPreference).toBe('auto')
    expect(document.documentElement.dataset.yachiyoLiquidGlassQuality).toBe('balanced')
    expect(document.documentElement.dataset.yachiyoLiquidGlassFallback).toBe('android-version')
    expect(localStorage.getItem(LIQUID_GLASS_QUALITY_STORAGE_KEY)).toBe('auto')
    expect(localStorage.getItem(LIQUID_GLASS_RESOLVED_QUALITY_STORAGE_KEY)).toBe('balanced')
  })

  it('re-resolves quality when an accessibility media preference changes', () => {
    const matches = new Map<string, boolean>()
    const listeners = new Map<string, Set<() => void>>()
    vi.stubGlobal('CSS', { supports: () => true })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: matches.get(query) ?? false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        const queryListeners = listeners.get(query) ?? new Set<() => void>()
        queryListeners.add(listener)
        listeners.set(query, queryListeners)
      },
      removeEventListener: (_type: string, listener: () => void) => listeners.get(query)?.delete(listener),
      addListener: undefined,
      removeListener: undefined,
      dispatchEvent: () => true,
    }))

    const stop = observeLiquidGlassQuality('balanced')
    expect(document.documentElement.dataset.yachiyoLiquidGlassQuality).toBe('balanced')

    const forcedColorsQuery = '(forced-colors: active)'
    matches.set(forcedColorsQuery, true)
    for (const listener of listeners.get(forcedColorsQuery) ?? []) listener()
    expect(document.documentElement.dataset.yachiyoLiquidGlassQuality).toBe('reduced')
    expect(document.documentElement.dataset.yachiyoLiquidGlassFallback).toBe('forced-colors')

    stop()
    expect(listeners.get(forcedColorsQuery)).toHaveLength(0)
  })
})
