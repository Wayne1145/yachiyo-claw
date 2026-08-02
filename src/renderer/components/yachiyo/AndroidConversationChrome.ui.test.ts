import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const shellSource = fs.readFileSync(path.join(__dirname, 'AndroidAppShell.tsx'), 'utf8')
const pagerHeaderSource = fs.readFileSync(path.join(__dirname, 'AndroidPagerHeaderTransition.tsx'), 'utf8')
const historySource = fs.readFileSync(path.join(__dirname, 'AndroidConversationHistory.tsx'), 'utf8')
const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')
const flowStyles = fs.readFileSync(path.join(__dirname, 'flow-glass.css'), 'utf8')
const layoutHeaderSource = fs.readFileSync(path.join(__dirname, '../layout/Header.tsx'), 'utf8')
const taskSource = fs.readFileSync(path.join(__dirname, '../../routes/task/$taskId.tsx'), 'utf8')
const messageListSource = fs.readFileSync(path.join(__dirname, '../chat/MessageList.tsx'), 'utf8')
const inputBoxSource = fs.readFileSync(path.join(__dirname, '../InputBox/InputBox.tsx'), 'utf8')
const newChatSource = fs.readFileSync(path.join(__dirname, '../../routes/index.tsx'), 'utf8')
const pluginHostSource = fs.readFileSync(path.join(__dirname, '../../plugins/PluginPageHost.tsx'), 'utf8')

describe('Android conversation chrome UI contract', () => {
  it('uses one Android-owned adaptive header with search, history, new topic, and connection status', () => {
    expect(layoutHeaderSource).toContain('if (inAndroidAppShell) return null')
    expect(shellSource).toContain("const showConversationTools = activeTab === 'chat'")
    expect(shellSource).not.toContain('<Toolbar')
    expect(shellSource).toContain('<AdaptiveActionCluster')
    expect(shellSource).toContain("id: 'search'")
    expect(shellSource).toContain("id: 'history'")
    expect(shellSource).toContain("id: 'new-topic'")
    expect(shellSource).toMatch(/id: 'new-topic'[\s\S]*?collapseStrategy: 'overflow'/)
    expect(shellSource).toMatch(/id: 'more'[\s\S]*?collapseStrategy: 'overflow'/)
    expect(shellSource).toContain('className="yachiyo-agent-disclosure-trigger"')
    expect(shellSource).toContain('aria-expanded={!conversationHeaderCollapsed}')
    expect(shellSource).toContain('setOpenSearchDialog(true, !toolbarSessionId)')
    expect(pagerHeaderSource).toContain('className="yachiyo-connection-indicator"')
    expect(shellStyles).toMatch(/\.yachiyo-mobile-conversation-tools\s*{[^}]*min-width:\s*132px;[^}]*max-width:/s)
  })

  it('hosts Interactive chrome in the same fixed shell header during pager transitions', () => {
    expect(shellSource).toContain('<AndroidSharedChromeHostProvider host={sharedChromeHost}>')
    expect(shellSource).toContain('className="yachiyo-shared-interactive-chrome-host"')
    expect(shellSource).toContain('<AndroidStandardChromeLayer activeInteractive={isInteractive}')
    expect(shellSource).not.toContain('{!isInteractive && (')
    expect(shellStyles).toMatch(
      /\.yachiyo-shared-interactive-chrome-host\s*{[^}]*display:\s*grid;[^}]*grid-area:\s*1 \/ 1;/s,
    )
  })

  it('uses the settings stack for plugin pages that do not fit in the bottom navigation', () => {
    expect(shellSource).toContain('activePluginHasShellTab')
    expect(shellSource).toMatch(/activePluginHasShellTab[\s\S]*?: 'settings'/)
    expect(shellSource).toContain('? activePlugin.manifest.displayName')
    expect(pluginHostSource).toContain('{!inAndroidAppShell && (')
    expect(shellSource).toContain('data-shell-tab={activeTab}')
    expect(flowStyles).toMatch(/\.yachiyo-mobile-header\[data-shell-tab=['"]settings['"]\][\s\S]*?blur\(24px\)/)
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
    expect(shellStyles).toMatch(
      /\.yachiyo-history-actions\s*{[^}]*width:\s*var\(--yachiyo-history-action-width\);[^}]*grid-template-columns:\s*repeat\(var\(--yachiyo-history-action-count\), 44px\);[^}]*gap:\s*6px;/s,
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-history-actions\[aria-hidden=["']true["']\]\s*{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s,
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-history-item\[data-active=["']true["']\]\s*{[^}]*background:\s*rgb\(231, 242, 253\)/s,
    )
    expect(historySource).toContain('opened={opened}')
    expect(historySource).toContain('getAndroidHistoryActionWidth(actions.length)')
    expect(historySource).toContain('data-yachiyo-tab-swipe="block"')
    expect(historySource).toContain('onPointerCancel={(event) => finishPointerGesture(event, true)}')
    expect(historySource).toContain('onLostPointerCapture={(event) => finishPointerGesture(event, true)}')
    expect(historySource).not.toContain('current < -56')
    expect(historySource).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?offset\.set\(0\)[\s\S]*?\}, \[opened, active, offset, stopAnimation\]\)/,
    )
  })

  it('limits top-drawer behavior to the liquid-glass theme and respects reduced motion', () => {
    expect(shellSource).toMatch(/yachiyo-mobile-header-primary[\s\S]*?yachiyo-mobile-header-collapsible/)
    expect(flowStyles).toMatch(
      /html\[data-yachiyo-appearance=["']flow-glass["']\][\s\S]*?\.yachiyo-mobile-header-collapsible/,
    )
    expect(shellSource).toContain('data-state="expanded"')
    expect(flowStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(shellSource).toContain('onClick={() => setConversationHeaderCollapsed((value) => !value)}')
  })

  it('uses one compact mobile composer with tools in a menu and one stateful primary action', () => {
    expect(inputBoxSource).toContain('className="yachiyo-mobile-composer-row"')
    expect(inputBoxSource).toContain('className="yachiyo-composer-add"')
    expect(inputBoxSource).toContain('display="label"')
    expect(inputBoxSource).toContain('data-mode={mobilePrimaryMode}')
    expect(inputBoxSource).toContain("placeholder={t('询问八千代…') || ''}")
    expect(inputBoxSource).not.toContain('yachiyo-chat-toolbar-scroll')
    expect(inputBoxSource).not.toContain('yachiyo-secondary-tools')
    const mobileMenuSource = inputBoxSource.slice(
      inputBoxSource.indexOf('<Menu.Dropdown className="yachiyo-composer-menu yachiyo-composer-popover">'),
      inputBoxSource.indexOf(
        '</Menu.Dropdown>',
        inputBoxSource.indexOf('<Menu.Dropdown className="yachiyo-composer-menu yachiyo-composer-popover">'),
      ),
    )
    expect(mobileMenuSource).not.toContain("t('New Thread')")
    expect(mobileMenuSource.indexOf("t('Attach Link')")).toBeLessThan(mobileMenuSource.indexOf("t('Web Search')"))
    expect(mobileMenuSource).not.toContain('<ModelSelector')
    expect(inputBoxSource).toContain('className="yachiyo-composer-model"')
    expect(inputBoxSource.indexOf('className="yachiyo-composer-model"')).toBeLessThan(
      inputBoxSource.indexOf('<ReasoningStrengthControl'),
    )
    expect(inputBoxSource).toContain('opened={mobileToolsOpened}')
    expect(inputBoxSource).toContain('onClick={() => setMobileToolsOpened(false)}')
    expect(flowStyles).toMatch(
      /\.yachiyo-mobile-composer-row \.yachiyo-composer-primary\s*\{[^}]*background:\s*#202124;[^}]*backdrop-filter:\s*none;/s,
    )
    expect(flowStyles).toMatch(/--flow-composer-height:\s*116px;/)
    expect(shellStyles).toMatch(
      /\.yachiyo-mobile-composer-row\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 74px 0 48px;/s,
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-composer-model\s*\{[^}]*max-width:\s*none;[^}]*justify-content:\s*flex-start;/s,
    )
    expect(shellStyles).toMatch(/\.yachiyo-composer-reasoning\s*\{[^}]*width:\s*74px;[^}]*white-space:\s*nowrap;/s)
    expect(flowStyles).toMatch(
      /\.yachiyo-adaptive-sheet\s*\{[^}]*max-height:\s*calc\(100dvh - var\(--mobile-safe-area-inset-top, 0px\)\);/s,
    )
  })

  it('keeps the composer above navigation in short landscape viewports', () => {
    expect(newChatSource).toContain("className={inAndroidAppShell ? 'yachiyo-chat-landing-slot' : undefined}")
    expect(inputBoxSource).toContain('minRows={isSmallScreen ? 1 : 2}')
    expect(shellStyles).toMatch(
      /@media \(orientation: landscape\) and \(max-height: 700px\)[\s\S]*?\.yachiyo-chat-landing-slot\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/,
    )
    expect(shellStyles).toMatch(/\.yachiyo-chat-landing-slot \.yachiyo-chat-landing\s*{[^}]*display:\s*none;/)
  })
})
