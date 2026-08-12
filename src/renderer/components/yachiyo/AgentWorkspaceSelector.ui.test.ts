import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Agent workspace selector mobile interaction', () => {
  it('uses the adaptive bottom-sheet selector and blocks pager gesture tunneling', () => {
    const panel = fs.readFileSync(path.join(__dirname, 'AgentConfigurationPanel.tsx'), 'utf8')
    const adaptive = fs.readFileSync(path.join(__dirname, '..', 'AdaptiveSelect.tsx'), 'utf8')

    expect(panel).toContain('<AdaptiveSelect')
    expect(panel).toContain("dropdown: 'pointer-events-auto'")
    expect(adaptive).toContain('useAndroidPagerGestureLock(isSmallScreen && drawerOpened)')
    expect(adaptive).toContain('data-yachiyo-tab-swipe="block"')
  })
})
