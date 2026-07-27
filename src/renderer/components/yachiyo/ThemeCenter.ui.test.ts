import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')
const modelStyles = fs.readFileSync(path.join(__dirname, 'local-model-center.css'), 'utf8')

describe('Android theme and responsive UI styles', () => {
  it('derives the shell palette from public theme variables instead of overriding them', () => {
    expect(shellStyles).toMatch(/--yachiyo-accent:\s*var\(--chatbox-tint-brand/)
    expect(shellStyles).toMatch(/--yachiyo-surface:\s*var\(--chatbox-background-primary/)
    expect(shellStyles).not.toMatch(/--chatbox-tint-brand:\s*#[0-9a-f]+/i)
    expect(modelStyles).toMatch(/color:\s*var\(--yachiyo-text/)
    expect(modelStyles).toMatch(/border:\s*1px solid var\(--yachiyo-border/)
  })

  it('uses one-column theme cards and compact controls on narrow portrait screens', () => {
    expect(shellStyles).toMatch(
      /@media \(max-width:\s*680px\)\s*{[\s\S]*?\.yachiyo-theme-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    )
    expect(shellStyles).toMatch(
      /@media \(orientation:\s*portrait\) and \(max-width:\s*360px\)\s*{[\s\S]*?\.yachiyo-connection-status\s*{[^}]*width:\s*34px/,
    )
    expect(shellStyles).toMatch(/\.yachiyo-theme-import-actions\s*>\s*\*\s*{[^}]*flex:\s*1 1 132px/s)
  })

  it('disables page and theme motion when the system requests reduced motion', () => {
    expect(shellStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.yachiyo-theme-card,[\s\S]*?animation:\s*none !important/,
    )
  })
})
