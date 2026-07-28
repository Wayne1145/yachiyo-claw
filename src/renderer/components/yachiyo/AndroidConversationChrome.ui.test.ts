import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const shellSource = fs.readFileSync(path.join(__dirname, 'AndroidAppShell.tsx'), 'utf8')
const historySource = fs.readFileSync(path.join(__dirname, 'AndroidConversationHistory.tsx'), 'utf8')
const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')
const flowStyles = fs.readFileSync(path.join(__dirname, 'flow-glass.css'), 'utf8')
const layoutHeaderSource = fs.readFileSync(path.join(__dirname, '../layout/Header.tsx'), 'utf8')
const toolbarSource = fs.readFileSync(path.join(__dirname, '../layout/Toolbar.tsx'), 'utf8')
const taskSource = fs.readFileSync(path.join(__dirname, '../../routes/task/$taskId.tsx'), 'utf8')
const messageListSource = fs.readFileSync(path.join(__dirname, '../chat/MessageList.tsx'), 'utf8')
const inputBoxSource = fs.readFileSync(path.join(__dirname, '../InputBox/InputBox.tsx'), 'utf8')
const newChatSource = fs.readFileSync(path.join(__dirname, '../../routes/index.tsx'), 'utf8')

describe('Android conversation chrome UI contract', () => {
  it('uses one Android-owned header with search, menu, and history in a stable order', () => {
    expect(layoutHeaderSource).toContain('if (inAndroidAppShell) return null')
    expect(shellSource).toMatch(/<Toolbar[^>]+androidShell\s*\/>[\s\S]*?<IconHistory/)
    expect(shellSource).toContain("const showConversationTools = activeTab === 'chat'")
    expect(shellSource).toContain('<Toolbar sessionId={toolbarSessionId} androidShell />')
    expect(toolbarSource).toContain('setOpenSearchDialog(true, !sessionId)')
    expect(toolbarSource).toContain('...(!androidShell')
    expect(toolbarSource).toContain("text: t('Thread History')")
    expect(shellStyles).toMatch(
      /@media \(max-width:\s*680px\)\s*{[\s\S]*?\.yachiyo-connection-status\s*{[^}]*width:\s*32px;[^}]*font-size:\s*0;/
    )
  })

  it('removes the duplicate Android Agent footer while keeping desktop directory controls', () => {
    expect(taskSource).toContain('{!inAndroidAppShell && (')
    expect(taskSource).not.toContain("t('内部工具 Agent')")
    expect(taskSource).toContain('<DirectoryMenu')
  })

  it('keeps system instructions in context but not in the Android visible transcript', () => {
    expect(messageListSource).toContain("messages.filter((message) => message.role !== 'system')")
  })

  it('supports opaque, scrollable history rows with rename and four swipe actions', () => {
    expect(historySource).toContain("t('重命名会话')")
    expect(historySource).toContain('onRename={() => openRename(record)}')
    expect(shellStyles).toMatch(/\.yachiyo-history-list\s*{[^}]*flex:\s*1 1 auto;[^}]*overflow-y:\s*auto;/s)
    expect(shellStyles).toMatch(/\.yachiyo-history-actions\s*{[^}]*grid-template-columns:\s*repeat\(4, 66px\);/s)
    expect(shellStyles).toMatch(
      /\.yachiyo-history-actions\[aria-hidden=["']true["']\]\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s
    )
    expect(shellStyles).toMatch(/\.yachiyo-history-item\[data-active=["']true["']\]\s*{[^}]*#fcebf1/s)
    expect(historySource).toContain('opened={opened}')
    expect(historySource).toMatch(/useEffect\(\(\) => \{[\s\S]*?setOffset\(0\)[\s\S]*?\}, \[opened, active\]\)/)
  })

  it('limits top-drawer behavior to the liquid-glass theme and respects reduced motion', () => {
    expect(shellSource).toMatch(/yachiyo-mobile-header-primary[\s\S]*?yachiyo-mobile-header-collapsible/)
    expect(flowStyles).toContain("html[data-yachiyo-appearance='flow-glass'] .yachiyo-mobile-header-collapsible")
    expect(flowStyles).toContain('.yachiyo-mobile-header-collapsible[data-collapsed=\'true\']')
    expect(flowStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(shellSource).toContain("t('收起顶部')")
    expect(shellSource).toContain("t('展开顶部')")
  })

  it('keeps Liquid Glass secondary tools collapsed behind a horizontal toggle', () => {
    expect(inputBoxSource).toContain('className="yachiyo-liquid-tools-toggle"')
    expect(inputBoxSource).toContain('className="yachiyo-secondary-tools"')
    expect(flowStyles).toContain('.yachiyo-secondary-tools[data-expanded=\'true\']')
    expect(flowStyles).toContain('backdrop-filter: blur(14px)')
  })

  it('keeps the composer above navigation in short landscape viewports', () => {
    expect(newChatSource).toContain("className={inAndroidAppShell ? 'yachiyo-chat-landing-slot' : undefined}")
    expect(inputBoxSource).toContain('minRows={isSmallScreen && viewportHeight < 500 ? 1 : 2}')
    expect(shellStyles).toMatch(
      /@media \(orientation: landscape\) and \(max-height: 700px\)[\s\S]*?\.yachiyo-chat-landing-slot\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/,
    )
    expect(shellStyles).toMatch(/\.yachiyo-chat-landing-slot \.yachiyo-chat-landing\s*{[^}]*display:\s*none;/)
  })
})
