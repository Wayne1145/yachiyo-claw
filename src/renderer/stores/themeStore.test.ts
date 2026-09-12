/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'
import { applyActiveTheme, BUILT_IN_LIQUID_GLASS_THEME, BUILT_IN_LIQUID_GLASS_THEME_ID, useThemeStore } from './themeStore'
import { uiStore } from './uiStore'

function theme(id: string, color: string) {
  return {
    schemaVersion: 1 as const,
    id,
    name: id,
    version: '1.0.0',
    mode: 'light' as const,
    tokens: { 'tint-brand': color },
  }
}

const brand = () => document.documentElement.style.getPropertyValue('--chatbox-tint-brand')
const background = () => document.documentElement.style.getPropertyValue('--chatbox-background-primary')

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    uiStore.setState({ realTheme: 'light' })
    useThemeStore.setState({ installed: [], activeThemeId: null, previewingTheme: null })
    applyActiveTheme()
  })

  it('uses the built-in flow-glass palette as the default and keeps the glass material on', () => {
    expect(useThemeStore.getState().activeThemeId).toBeNull()
    expect(document.documentElement.dataset.yachiyoAppearance).toBe('flow-glass')
    expect(brand()).toBe('#007aff')
    expect(background()).toBe('#ffffff')
  })

  it('switches the built-in palette with the light/dark scheme', () => {
    uiStore.setState({ realTheme: 'dark' })
    applyActiveTheme()

    expect(brand()).toBe('#0a84ff')
    expect(background()).toBe('#181d24')
    expect(document.documentElement.dataset.yachiyoAppearance).toBe('flow-glass')
  })

  it('persists installed and active themes and applies their safe variables over the glass base', () => {
    useThemeStore.getState().install(theme('rose', '#c45f82'))
    useThemeStore.getState().setActive('rose')

    expect(JSON.parse(localStorage.getItem('yachiyo:themes:installed:v1') || '[]')).toHaveLength(1)
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBe('rose')
    expect(brand()).toBe('#c45f82')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-brand-primary')).toBe('#c45f82')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-brand-secondary')).toBe(
      'rgba(196, 95, 130, 0.14)'
    )
    // Untouched tokens keep the flow-glass base values instead of being cleared.
    expect(background()).toBe('#ffffff')
    expect(document.documentElement.dataset.yachiyoAppearance).toBe('flow-glass')
  })

  it('previews without changing the persisted selection and restores it afterwards', () => {
    useThemeStore.getState().install(theme('rose', '#c45f82'))
    useThemeStore.getState().setActive('rose')
    useThemeStore.getState().preview(theme('mint', '#4a9b8e'))

    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBe('rose')
    expect(brand()).toBe('#4a9b8e')

    useThemeStore.getState().clearPreview()
    expect(brand()).toBe('#c45f82')
  })

  it('restores the built-in flow-glass palette when the active theme is removed', () => {
    useThemeStore.getState().install(theme('rose', '#a74668'))
    useThemeStore.getState().setActive('rose')
    useThemeStore.getState().remove('rose')

    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
    expect(brand()).toBe('#007aff')
  })

  it('ignores attempts to activate an uninstalled theme', () => {
    useThemeStore.getState().setActive('missing')
    expect(useThemeStore.getState().activeThemeId).toBeNull()
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
  })

  it('treats the legacy built-in id as an alias for the default selection', () => {
    useThemeStore.getState().install(theme('rose', '#c45f82'))
    useThemeStore.getState().setActive('rose')
    useThemeStore.getState().setActive(BUILT_IN_LIQUID_GLASS_THEME_ID)

    expect(useThemeStore.getState().activeThemeId).toBeNull()
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
    expect(brand()).toBe('#007aff')

    useThemeStore.getState().remove(BUILT_IN_LIQUID_GLASS_THEME_ID)
    expect(useThemeStore.getState().activeThemeId).toBeNull()
  })

  it('ships the flow-glass manifest metadata', () => {
    expect(BUILT_IN_LIQUID_GLASS_THEME.name).toBe('Yachiyo Flow Glass')
    expect(BUILT_IN_LIQUID_GLASS_THEME.mode).toBe('both')
  })

  it('prevents third-party manifests from replacing the built-in theme', () => {
    expect(() => useThemeStore.getState().install(theme(BUILT_IN_LIQUID_GLASS_THEME_ID, '#000000'))).toThrow(/reserved/)
  })

  it('falls back to the dark flow-glass palette when a light-only theme meets dark mode', () => {
    useThemeStore.getState().install(theme('rose', '#a74668'))
    useThemeStore.getState().setActive('rose')

    uiStore.setState({ realTheme: 'dark' })
    applyActiveTheme()

    expect(brand()).toBe('#0a84ff')
    expect(background()).toBe('#181d24')
  })

  it('applies a dark theme only while the app is using dark mode', () => {
    const darkTheme = {
      schemaVersion: 1 as const,
      id: 'night-rose',
      name: 'night-rose',
      version: '1.0.0',
      mode: 'dark' as const,
      tokens: { 'tint-brand': '#f09ab7', 'background-primary': '#171316' },
    }
    useThemeStore.getState().install(darkTheme)
    useThemeStore.getState().setActive(darkTheme.id)
    expect(brand()).toBe('#007aff')

    uiStore.setState({ realTheme: 'dark' })
    applyActiveTheme()
    expect(brand()).toBe('#f09ab7')
    expect(background()).toBe('#171316')
  })
})
