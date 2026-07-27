import { create } from 'zustand'
import { parseThemeManifest, resolveThemeVariables, type ThemeManifest } from '@shared/themes/theme'
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
        valid.push(parseThemeManifest(item))
      } catch {
        // Drop anything that no longer validates rather than trusting persisted bytes.
      }
    }
    return valid
  } catch {
    return []
  }
}

function loadActive(): string | null {
  try {
    return localStorage.getItem(STORAGE_ACTIVE) || null
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
const storedActiveThemeId = loadActive()
const initialActiveThemeId = initialInstalled.some((theme) => theme.id === storedActiveThemeId)
  ? storedActiveThemeId
  : null
if (storedActiveThemeId && !initialActiveThemeId) persistActive(null)

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  installed: initialInstalled,
  activeThemeId: initialActiveThemeId,
  previewingTheme: null,
  install(json) {
    const theme = parseThemeManifest(json)
    const installed = [...get().installed.filter((existing) => existing.id !== theme.id), theme]
    persistInstalled(installed)
    set({ installed })
    if (get().activeThemeId === theme.id) applyActiveTheme()
    return theme
  },
  remove(id) {
    const installed = get().installed.filter((existing) => existing.id !== id)
    persistInstalled(installed)
    const activeThemeId = get().activeThemeId === id ? null : get().activeThemeId
    persistActive(activeThemeId)
    const previewingTheme = get().previewingTheme?.id === id ? null : get().previewingTheme
    set({ installed, activeThemeId, previewingTheme })
    applyActiveTheme()
  },
  setActive(id) {
    if (id && !get().installed.some((existing) => existing.id === id)) return
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
  const theme = activeThemeId ? installed.find((existing) => existing.id === activeThemeId) : undefined
  const selectedTheme = previewingTheme ?? theme
  const scheme = currentScheme()
  const themeSupportsScheme =
    selectedTheme?.mode === 'both' || selectedTheme?.mode === scheme
  applyVariables({
    ...BUILT_IN_ANDROID_BRAND_VARIABLES,
    ...(scheme === 'light' ? BUILT_IN_ANDROID_LIGHT_VARIABLES : {}),
    ...(selectedTheme && themeSupportsScheme ? resolveAndroidThemeVariables(selectedTheme) : {}),
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
