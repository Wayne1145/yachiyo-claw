import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(__dirname, 'CodingWorkspace.tsx'), 'utf8')
const styles = fs.readFileSync(path.join(__dirname, 'coding-workspace.css'), 'utf8')

describe('Coding home Flow Glass contracts', () => {
  it('uses dedicated panel, control, and empty-state materials', () => {
    expect(source).toContain('className="coding-home-action coding-home-action-primary"')
    expect(source).toContain('className="coding-home-action coding-home-action-secondary"')
    expect(source).toContain('className="coding-empty-state"')
    expect(styles).toMatch(/\.coding-capability-band\s*\{[^}]*border-radius:\s*var\(--flow-r-panel\);[^}]*blur\(28px\)/s)
    expect(styles).toMatch(/\.coding-home-action\.mantine-Button-root\s*\{[^}]*min-height:\s*52px;[^}]*blur\(20px\)/s)
    expect(styles).toMatch(/\.coding-empty-state\s*\{[^}]*min-height:\s*60px;[^}]*border-radius:\s*var\(--flow-r-content\)/s)
  })

  it('keeps the refresh control accessible and large enough to touch', () => {
    expect(source).toContain('aria-label="刷新本地工具链状态"')
    expect(styles).toMatch(/\.coding-refresh-control\.mantine-Button-root\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s)
  })

  it('removes material effects for accessibility fallbacks', () => {
    const reducedStart = styles.indexOf('[data-yachiyo-liquid-glass-quality="reduced"]')
    const forcedStart = styles.indexOf('@media (forced-colors: active)')
    const reducedAndPreferences = styles.slice(reducedStart, forcedStart)
    const forcedColors = styles.slice(forcedStart)

    for (const selector of ['.coding-capability-band', '.coding-home-action', '.coding-empty-state']) {
      expect(reducedAndPreferences).toContain(selector)
      expect(forcedColors).toContain(selector)
    }
    expect(reducedAndPreferences).toContain('backdrop-filter: none;')
    expect(reducedAndPreferences).toContain('transform: none;')
    expect(forcedColors).toContain('background: Canvas;')
  })
})
