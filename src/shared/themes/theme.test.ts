import { describe, expect, it } from 'vitest'
import {
  MAX_THEME_MANIFEST_BYTES,
  isSafeCssColor,
  isThemeTokenKey,
  parseThemeManifest,
  parseThemeManifestText,
  resolveThemeVariables,
} from './theme'

function base(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'midnight-rose',
    name: '午夜玫瑰',
    version: '1.0.0',
    mode: 'both',
    tokens: { 'tint-brand': '#e68eaa', 'background-primary': '#0f0f14' },
    ...over,
  }
}

describe('isThemeTokenKey', () => {
  it('accepts namespaced color families and rejects everything else', () => {
    expect(isThemeTokenKey('tint-brand')).toBe(true)
    expect(isThemeTokenKey('background-brand-primary-hover')).toBe(true)
    expect(isThemeTokenKey('border-error')).toBe(true)
    expect(isThemeTokenKey('evil')).toBe(false)
    expect(isThemeTokenKey('spacing-md')).toBe(false)
    expect(isThemeTokenKey('tint-')).toBe(false)
    expect(isThemeTokenKey('--chatbox-tint-brand')).toBe(false)
    expect(isThemeTokenKey('tint-made-up')).toBe(false)
  })
})

describe('isSafeCssColor', () => {
  it('accepts hex, rgb, rgba, hsl', () => {
    for (const color of [
      '#fff',
      '#e68eaa',
      '#e68eaaff',
      'rgb(230,142,170)',
      'rgba(230, 142, 170, 0.5)',
      'hsl(340, 60%, 70%)',
      'hsla(340,60%,70%,0.4)',
    ]) {
      expect(isSafeCssColor(color)).toBe(true)
    }
  })
  it('rejects named colors and injection attempts', () => {
    for (const value of [
      'red',
      'blue',
      '#gggggg',
      'url(http://x)',
      'expression(alert(1))',
      'red; } body {',
      '#fff;',
      'rgb(0,0,0)/*x*/',
      '<script>',
      'javascript:1',
      '@import x',
    ]) {
      expect(isSafeCssColor(value)).toBe(false)
    }
  })
})

describe('parseThemeManifest', () => {
  it('accepts a minimal valid theme', () => {
    const theme = parseThemeManifest(base())
    expect(theme.id).toBe('midnight-rose')
    expect(theme.mode).toBe('both')
  })

  it('rejects a non-kebab-case id', () => {
    expect(() => parseThemeManifest(base({ id: 'Bad_Id' }))).toThrow()
  })

  it('rejects unknown top-level fields (strict)', () => {
    expect(() => parseThemeManifest(base({ script: 'alert(1)' }))).toThrow()
  })

  it('rejects an unknown token key', () => {
    expect(() => parseThemeManifest(base({ tokens: { 'evil-key': '#fff' } }))).toThrow()
  })

  it('rejects an unsafe color value', () => {
    expect(() => parseThemeManifest(base({ tokens: { 'tint-brand': 'red; } html {' } }))).toThrow()
    expect(() => parseThemeManifest(base({ tokens: { 'tint-brand': 'url(http://evil)' } }))).toThrow()
  })

  it('rejects an empty token set', () => {
    expect(() => parseThemeManifest(base({ tokens: {} }))).toThrow()
  })

  it('requires the matching palette for a single-mode theme', () => {
    expect(() =>
      parseThemeManifest({ ...base(), mode: 'dark', tokens: undefined, light: { tokens: { 'tint-brand': '#fff' } } }),
    ).toThrow()
    expect(() =>
      parseThemeManifest({ ...base(), mode: 'dark', tokens: undefined, dark: { tokens: { 'tint-brand': '#111' } } }),
    ).not.toThrow()
  })

  it('rejects a theme with no tokens at all', () => {
    expect(() => parseThemeManifest({ ...base(), tokens: undefined })).toThrow()
  })

  it('requires both palettes when a dual-mode theme has no shared tokens', () => {
    expect(() =>
      parseThemeManifest({
        ...base(),
        tokens: undefined,
        light: { tokens: { 'tint-brand': '#e68eaa' } },
      }),
    ).toThrow()
    expect(() =>
      parseThemeManifest({
        ...base(),
        tokens: undefined,
        light: { tokens: { 'tint-brand': '#e68eaa' } },
        dark: { tokens: { 'tint-brand': '#b95f7d' } },
      }),
    ).not.toThrow()
  })

  it('enforces the serialized manifest limit in the shared parser', () => {
    expect(() => parseThemeManifest({ ...base(), ignored: 'x'.repeat(MAX_THEME_MANIFEST_BYTES) })).toThrow(/exceeds/)
  })
})

describe('parseThemeManifestText', () => {
  it('parses valid JSON and reports malformed input as a theme error', () => {
    expect(parseThemeManifestText(JSON.stringify(base())).id).toBe('midnight-rose')
    expect(() => parseThemeManifestText('{not-json')).toThrow(/not valid JSON/)
  })

  it('measures the UTF-8 payload rather than JavaScript character count', () => {
    const oversized = `{"schemaVersion":1,"name":"${'月'.repeat(MAX_THEME_MANIFEST_BYTES / 2)}"}`
    expect(oversized.length).toBeLessThan(MAX_THEME_MANIFEST_BYTES)
    expect(() => parseThemeManifestText(oversized)).toThrow(/exceeds/)
  })
})

describe('resolveThemeVariables', () => {
  it('prefixes keys and layers the scheme overlay over the base tokens', () => {
    const theme = parseThemeManifest(
      base({
        tokens: { 'tint-brand': '#e68eaa' },
        dark: { tokens: { 'background-primary': '#0f0f14', 'tint-brand': '#c76a86' } },
      }),
    )
    const dark = resolveThemeVariables(theme, 'dark')
    expect(dark['--chatbox-tint-brand']).toBe('#c76a86') // overlay wins
    expect(dark['--chatbox-background-primary']).toBe('#0f0f14')
    const light = resolveThemeVariables(theme, 'light')
    expect(light['--chatbox-tint-brand']).toBe('#e68eaa') // base only
    expect(light['--chatbox-background-primary']).toBeUndefined()
  })
})
