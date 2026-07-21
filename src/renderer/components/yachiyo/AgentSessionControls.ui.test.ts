import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const componentSource = fs.readFileSync(path.join(__dirname, 'AgentSessionControls.tsx'), 'utf8')
const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')

describe('AgentSessionControls UI contract', () => {
  it('makes the disabled and enabled states visually and semantically distinct', () => {
    expect(componentSource).toContain("enabled ? 'Agent 已启用' : 'Agent 能力未启用'")
    expect(componentSource).toContain("variant={enabled ? 'filled' : 'outline'}")
    expect(componentSource).toContain("color={enabled ? undefined : 'gray'}")
    expect(componentSource).toContain('aria-pressed={enabled}')
    expect(shellStyles).toMatch(/\.yachiyo-agent-header-controls\[data-enabled=['"]false['"]\] \.yachiyo-agent-toggle/)
    expect(shellStyles).toContain('background: transparent;')
  })

  it('keeps both controls shrinkable on narrow portrait screens', () => {
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+minmax\(0,\s*1fr\)/s
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls button\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-agent-header-controls \.mantine-Button-label\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s
    )
  })
})
