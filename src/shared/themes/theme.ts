import { z } from 'zod'
import { FeatureIdSchema } from '../features/contract'

/**
 * Third-party theme manifest (v1: declarative color tokens only).
 *
 * A theme is DATA, never code. It overrides the app's `--chatbox-{tint,border,background}-*` CSS
 * variables — the same variables every Mantine `chatbox-*` color resolves to (see
 * `src/renderer/static/globals.css` and `routes/__root.tsx`), so applying a theme is just
 * `setProperty` on those variables and Mantine follows automatically. Token keys are namespaced to
 * the three known color families so a theme can never set an arbitrary CSS property, and every value
 * must be a plain CSS color so nothing like `url()` / expressions / `;}` injection can slip in.
 */

export const THEME_SCHEMA_VERSION = 1 as const
export const THEME_TOKEN_FAMILIES = ['tint', 'border', 'background'] as const
export type ThemeMode = 'light' | 'dark' | 'both'

/** Serialized theme package size ceiling; the manifest is tiny by construction. */
export const MAX_THEME_MANIFEST_BYTES = 64 * 1024

/** Theme v1 can only override color variables that are part of the public design-token contract. */
export const THEME_TOKEN_KEYS = [
  'tint-primary',
  'tint-secondary',
  'tint-tertiary',
  'tint-white',
  'tint-black',
  'tint-gray',
  'tint-disabled',
  'tint-brand',
  'tint-placeholder',
  'tint-error',
  'tint-error-disabled',
  'tint-warning',
  'tint-success',
  'border-primary',
  'border-secondary',
  'border-warning',
  'border-error',
  'border-success',
  'border-brand',
  'background-primary',
  'background-primary-hover',
  'background-secondary',
  'background-secondary-hover',
  'background-tertiary',
  'background-tertiary-hover',
  'background-disabled',
  'background-brand-primary',
  'background-brand-primary-hover',
  'background-brand-secondary',
  'background-brand-secondary-hover',
  'background-gray-primary',
  'background-gray-primary-hover',
  'background-gray-secondary',
  'background-gray-secondary-hover',
  'background-success-primary',
  'background-success-primary-hover',
  'background-success-secondary',
  'background-success-secondary-hover',
  'background-error-primary',
  'background-error-primary-hover',
  'background-error-secondary',
  'background-error-secondary-hover',
  'background-warning-primary',
  'background-warning-primary-hover',
  'background-warning-secondary',
  'background-warning-secondary-hover',
  'background-mask-overlay',
  'background-mask-lighten',
] as const

const THEME_TOKEN_KEY_SET = new Set<string>(THEME_TOKEN_KEYS)

// key must be "<family>-<name>", e.g. "tint-brand" -> sets --chatbox-tint-brand.
const TOKEN_KEY_REGEX = new RegExp(`^(?:${THEME_TOKEN_FAMILIES.join('|')})-[a-z0-9]+(?:-[a-z0-9]+)*$`)
export function isThemeTokenKey(key: string): boolean {
  return TOKEN_KEY_REGEX.test(key) && THEME_TOKEN_KEY_SET.has(key)
}

// Accept hex, rgb/rgba, hsl/hsla only — no url(), no functions, no separators that could break out.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i
const HSL = /^hsla?\(\s*[\d.]+(?:deg)?\s*[, ]\s*[\d.]+%\s*[, ]\s*[\d.]+%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i
export function isSafeCssColor(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length > 64) return false
  // Defense in depth: reject anything that could escape the property value context.
  if (/[;{}<>()]/.test(trimmed) && !RGB.test(trimmed) && !HSL.test(trimmed)) return false
  if (/url|expression|javascript:|@import|\/\*/i.test(trimmed)) return false
  return HEX.test(trimmed) || RGB.test(trimmed) || HSL.test(trimmed)
}

const ThemeTokensSchema = z
  .record(z.string(), z.string())
  .refine((tokens) => Object.keys(tokens).length > 0, 'A theme must define at least one token')
  .refine((tokens) => Object.keys(tokens).length <= 128, 'Too many theme tokens')
  .superRefine((tokens, context) => {
    for (const [key, value] of Object.entries(tokens)) {
      if (!isThemeTokenKey(key)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown theme token "${key}" (not part of the theme v${THEME_SCHEMA_VERSION} token contract).`,
          path: [key],
        })
      }
      if (!isSafeCssColor(value)) {
        context.addIssue({ code: 'custom', message: `Token "${key}" is not a valid CSS color.`, path: [key] })
      }
    }
  })

const PaletteSchema = z.object({ tokens: ThemeTokensSchema }).strict()

export const ThemeManifestSchema = z
  .object({
    schemaVersion: z.literal(THEME_SCHEMA_VERSION),
    id: FeatureIdSchema,
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(64),
    author: z
      .object({ name: z.string().trim().min(1).max(120), url: z.string().url().max(300).optional() })
      .strict()
      .optional(),
    mode: z.enum(['light', 'dark', 'both']),
    /** Shared tokens applied in every scheme. Optional when both light and dark palettes are given. */
    tokens: ThemeTokensSchema.optional(),
    /** Scheme-specific overrides, layered on top of `tokens`. */
    light: PaletteSchema.optional(),
    dark: PaletteSchema.optional(),
  })
  .strict()
  .superRefine((theme, context) => {
    const hasBase = Boolean(theme.tokens)
    if (!hasBase && !theme.light && !theme.dark) {
      context.addIssue({ code: 'custom', message: 'A theme must define tokens, or a light/dark palette.' })
    }
    if (theme.mode === 'light' && !hasBase && !theme.light) {
      context.addIssue({ code: 'custom', message: 'A light theme must define light tokens.' })
    }
    if (theme.mode === 'dark' && !hasBase && !theme.dark) {
      context.addIssue({ code: 'custom', message: 'A dark theme must define dark tokens.' })
    }
    if (theme.mode === 'both' && !hasBase && (!theme.light || !theme.dark)) {
      context.addIssue({
        code: 'custom',
        message: 'A dual-mode theme without shared tokens must define both light and dark palettes.',
      })
    }
  })

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>

export class ThemeManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThemeManifestError'
  }
}

export function themeManifestByteLength(value: unknown): number {
  let serialized: string
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    throw new ThemeManifestError('Invalid theme: the manifest must be JSON-serializable.')
  }
  if (serialized === undefined) {
    throw new ThemeManifestError('Invalid theme: the manifest must be a JSON object.')
  }
  return new TextEncoder().encode(serialized).byteLength
}

export function parseThemeManifest(json: unknown): ThemeManifest {
  if (themeManifestByteLength(json) > MAX_THEME_MANIFEST_BYTES) {
    throw new ThemeManifestError(`Invalid theme: manifest exceeds ${MAX_THEME_MANIFEST_BYTES} bytes.`)
  }
  const result = ThemeManifestSchema.safeParse(json)
  if (!result.success) {
    throw new ThemeManifestError(
      `Invalid theme: ${result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`,
    )
  }
  return result.data
}

export function parseThemeManifestText(text: string): ThemeManifest {
  if (themeManifestByteLength(text) > MAX_THEME_MANIFEST_BYTES) {
    throw new ThemeManifestError(`Invalid theme: manifest exceeds ${MAX_THEME_MANIFEST_BYTES} bytes.`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ThemeManifestError('Invalid theme: the file is not valid JSON.')
  }
  return parseThemeManifest(json)
}

/** Resolves the CSS variables to apply for a given color scheme: base tokens then the scheme overlay. */
export function resolveThemeVariables(theme: ThemeManifest, scheme: 'light' | 'dark'): Record<string, string> {
  const merged: Record<string, string> = { ...(theme.tokens ?? {}) }
  const overlay = scheme === 'dark' ? theme.dark?.tokens : theme.light?.tokens
  Object.assign(merged, overlay ?? {})
  const variables: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) variables[`--chatbox-${key}`] = value
  return variables
}
