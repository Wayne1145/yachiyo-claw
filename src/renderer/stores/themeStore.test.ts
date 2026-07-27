/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'
import { applyActiveTheme, BUILT_IN_LIQUID_GLASS_THEME_ID, useThemeStore } from './themeStore'
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

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    uiStore.setState({ realTheme: 'light' })
    useThemeStore.setState({ installed: [], activeThemeId: null, previewingTheme: null })
    applyActiveTheme()
  })

  it('persists installed and active themes and applies their safe variables', () => {
    useThemeStore.getState().install(theme('rose', '#c45f82'))
    useThemeStore.getState().setActive('rose')

    expect(JSON.parse(localStorage.getItem('yachiyo:themes:installed:v1') || '[]')).toHaveLength(1)
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBe('rose')
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#c45f82')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-brand-primary')).toBe('#c45f82')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-brand-secondary')).toBe(
      'rgba(196, 95, 130, 0.14)'
    )
  })

  it('previews without changing the persisted selection and restores it afterwards', () => {
    useThemeStore.getState().install(theme('rose', '#c45f82'))
    useThemeStore.getState().setActive('rose')
    useThemeStore.getState().preview(theme('mint', '#4a9b8e'))

    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBe('rose')
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#4a9b8e')

    useThemeStore.getState().clearPreview()
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#c45f82')
  })

  it('restores the built-in pink palette when the active theme is removed', () => {
    useThemeStore.getState().install(theme('rose', '#a74668'))
    useThemeStore.getState().setActive('rose')
    useThemeStore.getState().remove('rose')

    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#d87597')
  })

  it('ignores attempts to activate an uninstalled theme', () => {
    useThemeStore.getState().setActive('missing')
    expect(useThemeStore.getState().activeThemeId).toBeNull()
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
  })

  it('activates the non-removable built-in liquid-glass appearance', () => {
    useThemeStore.getState().setActive(BUILT_IN_LIQUID_GLASS_THEME_ID)

    expect(useThemeStore.getState().activeThemeId).toBe(BUILT_IN_LIQUID_GLASS_THEME_ID)
    expect(document.documentElement.dataset.yachiyoAppearance).toBe('liquid-glass')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-primary')).toBe('#ffffff')

    useThemeStore.getState().remove(BUILT_IN_LIQUID_GLASS_THEME_ID)
    expect(useThemeStore.getState().activeThemeId).toBe(BUILT_IN_LIQUID_GLASS_THEME_ID)
  })

  it('prevents third-party manifests from replacing a built-in theme', () => {
    expect(() => useThemeStore.getState().install(theme(BUILT_IN_LIQUID_GLASS_THEME_ID, '#000000'))).toThrow(/reserved/)
  })

  it('does not force light surfaces or a light-only theme into dark mode', () => {
    useThemeStore.getState().install(theme('rose', '#a74668'))
    useThemeStore.getState().setActive('rose')

    uiStore.setState({ realTheme: 'dark' })
    applyActiveTheme()

    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#d87597')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-primary')).toBe('')
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
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#d87597')

    uiStore.setState({ realTheme: 'dark' })
    applyActiveTheme()
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#f09ab7')
    expect(document.documentElement.style.getPropertyValue('--chatbox-background-primary')).toBe('#171316')
  })
})
