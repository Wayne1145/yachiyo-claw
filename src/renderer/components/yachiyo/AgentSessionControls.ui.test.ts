import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const componentSource = fs.readFileSync(path.join(__dirname, 'AgentSessionControls.tsx'), 'utf8')
const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')

describe('AgentSessionControls UI contract', () => {
  it('does not turn a per-session phone toggle into the global shell full-access grant', () => {
    expect(componentSource).not.toContain('setAgentFullAccessEnabled')
  })

  it('makes the disabled and enabled states visually and semantically distinct', () => {
    expect(componentSource).toContain("enabled ? t('Agent 已启用') : t('Agent 能力未启用')")
    expect(componentSource).toContain("variant={enabled ? 'filled' : 'outline'}")
    expect(componentSource).toContain("color={enabled ? undefined : 'gray'}")
    expect(componentSource).toContain('aria-pressed={enabled}')
    expect(shellStyles).toMatch(/\.yachiyo-agent-header-controls\[data-enabled=['"]false['"]\] \.yachiyo-agent-toggle/)
    expect(shellStyles).toContain('background: transparent;')
  })

  it('keeps adaptive controls shrinkable with non-overlapping touch targets', () => {
    expect(componentSource).toContain('className="yachiyo-agent-header-actions"')
    expect(componentSource).toContain("collapseStrategy: 'icon'")
    expect(componentSource).toContain("collapseStrategy: 'icon-then-overflow'")
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls\s*{[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s,
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls button\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*min-height:\s*44px;/s,
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls \.mantine-Button-label\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    )
  })
})
