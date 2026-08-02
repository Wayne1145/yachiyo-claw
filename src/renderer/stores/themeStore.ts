import { create } from 'zustand'
import { parseThemeManifest, resolveThemeVariables, ThemeManifestError, type ThemeManifest } from '@shared/themes/theme'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { uiStore } from './uiStore'

/**
 * Third-party theme store (renderer side).
 *
 * Installed themes are re-validated on load so a tampered persisted store can never inject an unsafe
 * value. Applying a theme only calls `setProperty` on the whitelisted `--chatbox-*` variables Mantine
 * already reads, and clears them on switch/removal — no code runs, no stylesheet is injected.
 */

const STORAGE_INSTALLED = 'yachiyo:themes:installed:v1'
const STORAGE_ACTIVE = 'yachiyo:themes:active:v1'
const STORAGE_ANDROID_FLOW_GLASS_MIGRATION = 'yachiyo:appearance:flow-glass:migration:v2'
export const BUILT_IN_LIQUID_GLASS_THEME_ID = 'yachiyo-liquid-glass'

export const BUILT_IN_LIQUID_GLASS_THEME: ThemeManifest = parseThemeManifest({
  schemaVersion: 1,
  id: BUILT_IN_LIQUID_GLASS_THEME_ID,
  name: 'Yachiyo Flow Glass',
  version: '2.0.0',
  author: { name: 'NewDreamStudio' },
  mode: 'both',
  tokens: {
    'tint-primary': '#17181b',
    'tint-secondary': '#4f555c',
    'tint-tertiary': '#747b84',
    'tint-brand': '#007aff',
    'border-primary': '#dfe3e8',
    'border-secondary': '#ebedf0',
    'border-brand': '#007aff',
    'background-primary': '#ffffff',
    'background-primary-hover': '#f8f9fb',
    'background-secondary': 'rgba(246, 247, 249, 0.78)',
    'background-secondary-hover': 'rgba(238, 240, 244, 0.86)',
    'background-tertiary': 'rgba(232, 235, 240, 0.68)',
    'background-tertiary-hover': 'rgba(225, 229, 235, 0.78)',
    'background-brand-primary': '#007aff',
    'background-brand-primary-hover': '#006ee6',
    'background-brand-secondary': 'rgba(0, 122, 255, 0.12)',
    'background-brand-secondary-hover': 'rgba(0, 122, 255, 0.2)',
  },
})

const BUILT_IN_FLOW_GLASS_LIGHT_VARIABLES: Record<string, string> = {
  '--chatbox-tint-primary': '#17212b',
  '--chatbox-tint-secondary': '#455463',
  '--chatbox-tint-tertiary': '#687786',
  '--chatbox-tint-brand': '#007aff',
  '--chatbox-border-primary': 'rgba(69, 87, 104, 0.16)',
  '--chatbox-border-secondary': 'rgba(69, 87, 104, 0.1)',
  '--chatbox-border-brand': '#007aff',
  '--chatbox-background-primary': '#ffffff',
  '--chatbox-background-primary-hover': '#f5f9fc',
  '--chatbox-background-secondary': 'rgba(250, 252, 255, 0.68)',
  '--chatbox-background-secondary-hover': 'rgba(240, 247, 253, 0.82)',
  '--chatbox-background-tertiary': 'rgba(232, 241, 249, 0.7)',
  '--chatbox-background-tertiary-hover': 'rgba(222, 235, 247, 0.82)',
  '--chatbox-background-brand-primary': '#007aff',
  '--chatbox-background-brand-primary-hover': '#006ee6',
  '--chatbox-background-brand-secondary': 'rgba(0, 122, 255, 0.12)',
  '--chatbox-background-brand-secondary-hover': 'rgba(0, 122, 255, 0.2)',
}

const BUILT_IN_FLOW_GLASS_DARK_VARIABLES: Record<string, string> = {
  '--chatbox-tint-primary': '#f4f7fa',
  '--chatbox-tint-secondary': '#b9c2cc',
  '--chatbox-tint-tertiary': '#8d99a5',
  '--chatbox-tint-brand': '#0a84ff',
  '--chatbox-border-primary': 'rgba(230, 237, 244, 0.14)',
  '--chatbox-border-secondary': 'rgba(230, 237, 244, 0.09)',
  '--chatbox-border-brand': '#0a84ff',
  '--chatbox-background-primary': '#181d24',
  '--chatbox-background-primary-hover': '#20262e',
  '--chatbox-background-secondary': 'rgba(27, 33, 41, 0.72)',
  '--chatbox-background-secondary-hover': 'rgba(38, 45, 54, 0.82)',
  '--chatbox-background-tertiary': 'rgba(43, 50, 60, 0.76)',
  '--chatbox-background-tertiary-hover': 'rgba(52, 61, 72, 0.86)',
  '--chatbox-background-brand-primary': '#0a84ff',
  '--chatbox-background-brand-primary-hover': '#409cff',
  '--chatbox-background-brand-secondary': 'rgba(10, 132, 255, 0.16)',
  '--chatbox-background-brand-secondary-hover': 'rgba(10, 132, 255, 0.24)',
}

function isBuiltInThemeId(id: string | null | undefined): id is typeof BUILT_IN_LIQUID_GLASS_THEME_ID {
  return id === BUILT_IN_LIQUID_GLASS_THEME_ID
}

// Android's built-in palette is the base layer. Third-party themes override only the tokens they
// declare, so a small accent-only theme never falls back to Chatbox's blue defaults.
const BUILT_IN_ANDROID_BRAND_VARIABLES: Record<string, string> = {
  '--chatbox-tint-brand': '#d87597',
  '--chatbox-border-brand': '#e68eaa',
  '--chatbox-background-brand-primary': '#e68eaa',
  '--chatbox-background-brand-primary-hover': '#d87597',
  '--chatbox-background-brand-secondary': 'rgba(230, 142, 170, 0.14)',
  '--chatbox-background-brand-secondary-hover': 'rgba(230, 142, 170, 0.22)',
}

const BUILT_IN_ANDROID_LIGHT_VARIABLES: Record<string, string> = {
  '--chatbox-background-primary': '#ffffff',
  '--chatbox-background-primary-hover': '#f7f9fa',
  '--chatbox-background-secondary': '#eef3f4',
  '--chatbox-background-secondary-hover': '#e5ecee',
  '--chatbox-border-primary': '#dbe4e7',
}

function loadInstalled(): ThemeManifest[] {
  try {
    const raw = localStorage.getItem(STORAGE_INSTALLED)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    const valid: ThemeManifest[] = []
    for (const item of list) {
      try {
        const theme = parseThemeManifest(item)
        if (!isBuiltInThemeId(theme.id)) valid.push(theme)
      } catch {
        // Drop anything that no longer validates rather than trusting persisted bytes.
      }
    }
    return valid
  } catch {
    return []
  }
}

export function migrateAndroidFlowGlassAppearance(
  buildPlatform: string = CHATBOX_BUILD_PLATFORM,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage
): string | null {
  try {
    const storedActive = storage.getItem(STORAGE_ACTIVE) || null
    if (buildPlatform !== 'android') return storedActive
    if (storage.getItem(STORAGE_ANDROID_FLOW_GLASS_MIGRATION) === '2.0.0') return storedActive

    storage.setItem(STORAGE_ACTIVE, BUILT_IN_LIQUID_GLASS_THEME_ID)
    storage.setItem(STORAGE_ANDROID_FLOW_GLASS_MIGRATION, '2.0.0')
    return BUILT_IN_LIQUID_GLASS_THEME_ID
  } catch {
    return null
  }
}

function persistInstalled(list: ThemeManifest[]): void {
  try {
    localStorage.setItem(STORAGE_INSTALLED, JSON.stringify(list))
  } catch {
    // Best-effort persistence; an in-memory theme still applies for this session.
  }
}

function persistActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_ACTIVE, id)
    else localStorage.removeItem(STORAGE_ACTIVE)
  } catch {
    // Ignored; see persistInstalled.
  }
}

let appliedVariables = new Set<string>()
function applyVariables(variables: Record<string, string>): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const name of appliedVariables) if (!(name in variables)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  appliedVariables = new Set(Object.keys(variables))
}

interface ThemeStoreState {
  installed: ThemeManifest[]
  activeThemeId: string | null
  previewingTheme: ThemeManifest | null
  /** Parses + validates JSON, installs (replacing any same-id theme). Throws on an invalid theme. */
  install(json: unknown): ThemeManifest
  remove(id: string): void
  setActive(id: string | null): void
  preview(json: unknown): ThemeManifest
  clearPreview(): void
}

const initialInstalled = loadInstalled()
const storedActiveThemeId = migrateAndroidFlowGlassAppearance()
const initialActiveThemeId =
  isBuiltInThemeId(storedActiveThemeId) || initialInstalled.some((theme) => theme.id === storedActiveThemeId)
    ? storedActiveThemeId
    : null
if (storedActiveThemeId && !initialActiveThemeId) persistActive(null)

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  installed: initialInstalled,
  activeThemeId: initialActiveThemeId,
  previewingTheme: null,
  install(json) {
    const theme = parseThemeManifest(json)
    if (isBuiltInThemeId(theme.id))
      throw new ThemeManifestError('Invalid theme: this id is reserved for a built-in theme.')
    const installed = [...get().installed.filter((existing) => existing.id !== theme.id), theme]
    persistInstalled(installed)
    set({ installed })
    if (get().activeThemeId === theme.id) applyActiveTheme()
    return theme
  },
  remove(id) {
    if (isBuiltInThemeId(id)) return
    const installed = get().installed.filter((existing) => existing.id !== id)
    persistInstalled(installed)
    const activeThemeId = get().activeThemeId === id ? null : get().activeThemeId
    persistActive(activeThemeId)
    const previewingTheme = get().previewingTheme?.id === id ? null : get().previewingTheme
    set({ installed, activeThemeId, previewingTheme })
    applyActiveTheme()
  },
  setActive(id) {
    if (id && !isBuiltInThemeId(id) && !get().installed.some((existing) => existing.id === id)) return
    persistActive(id)
    set({ activeThemeId: id, previewingTheme: null })
    applyActiveTheme()
  },
  preview(json) {
    const theme = parseThemeManifest(json)
    set({ previewingTheme: theme })
    applyActiveTheme()
    return theme
  },
  clearPreview() {
    if (!get().previewingTheme) return
    set({ previewingTheme: null })
    applyActiveTheme()
  },
}))

function currentScheme(): 'light' | 'dark' {
  return uiStore.getState().realTheme === 'dark' ? 'dark' : 'light'
}

function hexWithAlpha(color: string, alpha: number): string | undefined {
  const normalized = color.trim()
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(normalized)
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(normalized)
  const channels = short
    ? short.slice(1).map((channel) => Number.parseInt(`${channel}${channel}`, 16))
    : full
      ? full.slice(1).map((channel) => Number.parseInt(channel, 16))
      : undefined
  return channels ? `rgba(${channels.join(', ')}, ${alpha})` : undefined
}

function resolveAndroidThemeVariables(theme: ThemeManifest): Record<string, string> {
  const variables = resolveThemeVariables(theme, currentScheme())
  const brand = variables['--chatbox-tint-brand']
  if (!brand) return variables

  // tint-brand is the convenient minimum theme token. Keep Mantine controls and shell accents in
  // the same family unless the author supplied more specific brand tokens.
  variables['--chatbox-border-brand'] ??= brand
  variables['--chatbox-background-brand-primary'] ??= brand
  variables['--chatbox-background-brand-primary-hover'] ??= brand
  const secondary = hexWithAlpha(brand, 0.14)
  const secondaryHover = hexWithAlpha(brand, 0.22)
  if (secondary) variables['--chatbox-background-brand-secondary'] ??= secondary
  if (secondaryHover) variables['--chatbox-background-brand-secondary-hover'] ??= secondaryHover
  return variables
}

/** Applies the active theme's variables for the current light/dark scheme, or clears them. */
export function applyActiveTheme(): void {
  const { activeThemeId, installed, previewingTheme } = useThemeStore.getState()
  const theme = isBuiltInThemeId(activeThemeId)
    ? BUILT_IN_LIQUID_GLASS_THEME
    : activeThemeId
      ? installed.find((existing) => existing.id === activeThemeId)
      : undefined
  const selectedTheme = previewingTheme ?? theme
  const scheme = currentScheme()
  const themeSupportsScheme = selectedTheme?.mode === 'both' || selectedTheme?.mode === scheme
  const selectedVariables = isBuiltInThemeId(selectedTheme?.id)
    ? scheme === 'dark'
      ? BUILT_IN_FLOW_GLASS_DARK_VARIABLES
      : BUILT_IN_FLOW_GLASS_LIGHT_VARIABLES
    : selectedTheme && themeSupportsScheme
      ? resolveAndroidThemeVariables(selectedTheme)
      : {}
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.yachiyoAppearance =
      selectedTheme?.id === BUILT_IN_LIQUID_GLASS_THEME_ID ? 'flow-glass' : 'default'
  }
  applyVariables({
    ...BUILT_IN_ANDROID_BRAND_VARIABLES,
    ...(scheme === 'light' ? BUILT_IN_ANDROID_LIGHT_VARIABLES : {}),
    ...selectedVariables,
  })
}

let initialized = false
/** Idempotent startup hook: apply the active theme and re-apply whenever the light/dark scheme flips. */
export function initThemeApplication(): void {
  if (initialized) return
  initialized = true
  applyActiveTheme()
  let lastScheme = currentScheme()
  uiStore.subscribe((state) => {
    const scheme = state.realTheme === 'dark' ? 'dark' : 'light'
    if (scheme !== lastScheme) {
      lastScheme = scheme
      applyActiveTheme()
    }
  })
}
