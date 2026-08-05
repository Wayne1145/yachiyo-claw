import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const flowStyles = fs.readFileSync(path.join(__dirname, 'flow-glass.css'), 'utf8')
const shellStyles = fs.readFileSync(path.join(__dirname, 'android-app-shell.css'), 'utf8')
const workspaceSource = fs.readFileSync(path.join(__dirname, 'AndroidWorkspaceHome.tsx'), 'utf8')
const inputBoxSource = fs.readFileSync(path.join(__dirname, '../InputBox/InputBox.tsx'), 'utf8')
const viteConfigSource = fs.readFileSync(path.join(__dirname, '../../../../electron.vite.config.ts'), 'utf8')
const assetRoot = path.join(__dirname, '../../public/liquid-glass')

function readHexToken(styles: string, selector: string, property: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/["']/g, '["\']')
  const block = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1]
  const value = block?.match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  if (!value) throw new Error(`Missing ${property} in ${selector}`)
  return value
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

const materialSelectors = [
  '.yachiyo-mobile-conversation-tools',
  '.yachiyo-agent-header-controls',
  '.yachiyo-mobile-header .mantine-ActionIcon-root',
  '.yachiyo-interactive-header .mantine-ActionIcon-root',
  '.yachiyo-mobile-header-collapse',
  '.yachiyo-connection-status',
  '.yachiyo-bottom-nav-grid',
  '.yachiyo-bottom-nav-lens',
  '.yachiyo-bottom-nav-lens-inner',
  '.yachiyo-chat-composer-surface',
  '.yachiyo-task-composer-panel',
  '.bubble-user-msg .inline-block.max-w-full',
  '.yachiyo-agent-user-message',
  '.shiki-code-wrapper',
  '.msg-content pre',
  '.msg-content table',
  '.yachiyo-approval-detail',
  '.yachiyo-agent-config-panel',
  '.local-model-queue-row',
  '.local-model-installed-row',
  '.yachiyo-settings-list',
  '.yachiyo-settings-panel',
  '.yachiyo-status-panel',
  '.yachiyo-about-brand',
  '.yachiyo-onboarding-panel',
  '.yachiyo-theme-card',
  '.yachiyo-task-toolbar',
  '.yachiyo-scheduled-task-list',
  '.yachiyo-agent-access-panel',
  '.yachiyo-agent-launch-panel',
  '.local-model-results',
  '.local-model-summary-grid',
  '.local-model-device-metrics',
  '.local-model-metadata',
  '.yachiyo-adaptive-surface',
  '.yachiyo-adaptive-overlay',
  '.mantine-Menu-dropdown',
  '.mantine-Popover-dropdown',
  '.mantine-Combobox-dropdown',
  '.mantine-Modal-content',
  '.mantine-Drawer-content',
  '.yachiyo-theme-preview-chrome',
  '.yachiyo-theme-preview-nav',
  '.yachiyo-interactive-round-button',
  '.yachiyo-interactive-llm-selector',
  '.yachiyo-interactive-keyboard-input .mantine-Textarea-input',
  '.yachiyo-live-bubble',
  '.yachiyo-live-transcript',
  '.yachiyo-interactive-notice',
  '.yachiyo-live2d-model-row',
]

function sectionBetween(start: string, end: string) {
  const startIndex = flowStyles.indexOf(start)
  const endIndex = flowStyles.indexOf(end, startIndex + start.length)

  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return flowStyles.slice(startIndex, endIndex)
}

describe('Flow Glass visual contracts', () => {
  it('keeps the continuous corner scale and concentric navigation geometry', () => {
    expect(flowStyles).toContain('--flow-r-nav: 24px')
    expect(flowStyles).toContain('--flow-r-lens: 18px')
    expect(flowStyles).toContain('--flow-r-composer: 24px')
    expect(flowStyles).toContain('--flow-r-sheet: 24px')
    expect(flowStyles).toContain('--flow-r-popover: 18px')
    expect(flowStyles).toContain('--flow-r-panel: 18px')
    expect(flowStyles).toContain('--flow-r-content: 14px')
    expect(flowStyles).toContain('--flow-r-control: 14px')
    expect(shellStyles).toContain('--yachiyo-r-shell: 24px')
    expect(shellStyles).toContain('--yachiyo-r-surface: 18px')
    expect(shellStyles).toContain('--yachiyo-r-control: 14px')
    expect(shellStyles).not.toMatch(/border-radius:\s*999px/)
    expect(shellStyles).not.toMatch(/\.yachiyo-bottom-nav-item:active\s*\{[^}]*transform:\s*scale/s)
    expect(flowStyles).not.toMatch(/\.yachiyo-bottom-nav-item:active[^\{]*\{[^}]*transform:\s*scale/s)
    expect(flowStyles).toMatch(/\.yachiyo-bottom-nav-grid\s*{[^}]*height:\s*64px;[^}]*padding:\s*5px;/s)
    expect(flowStyles).toMatch(/\.yachiyo-bottom-nav-lens\s*{[^}]*top:\s*5px;[^}]*left:\s*5px;[^}]*height:\s*54px;/s)
    expect(flowStyles).toMatch(
      /\.yachiyo-mobile-conversation-tools \.mantine-ActionIcon-root\s*{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s
    )
    expect(flowStyles).toMatch(
      /\.yachiyo-mobile-header \.mantine-ActionIcon-root,[^}]*border-radius:\s*var\(--flow-r-control\);[^}]*corner-shape:\s*squircle;/s
    )
    expect(flowStyles).toMatch(
      /\.yachiyo-chat-composer-surface \.mantine-ActionIcon-root\s*\{[^}]*border-radius:\s*var\(--flow-r-control\);/s
    )
    expect(flowStyles).not.toContain('clip-path: circle(50% at 50% 50%)')
    expect(flowStyles).not.toMatch(/\.yachiyo-mobile-conversation-tools\s*\{[^}]*border-radius:\s*20px;/s)
  })

  it('keeps small active navigation labels above WCAG AA contrast in both color schemes', () => {
    const lightLabel = readHexToken(flowStyles, 'html[data-yachiyo-appearance="flow-glass"]', '--flow-nav-active-label')
    const darkLabel = readHexToken(
      flowStyles,
      'html[data-yachiyo-appearance="flow-glass"][data-theme="dark"]',
      '--flow-nav-active-label'
    )

    expect(contrastRatio(lightLabel, '#f8fbfe')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkLabel, '#262c35')).toBeGreaterThanOrEqual(4.5)
    expect(flowStyles).toMatch(
      /\.yachiyo-bottom-nav-item\[data-active=["']true["']\]\s*\{[^}]*color:\s*var\(--flow-nav-active-label\);/s
    )
  })

  it('refracts the backdrop without reviving the legacy theme cascade', () => {
    expect(flowStyles).toMatch(/backdrop-filter:\s*url\(["']#yachiyo-flow-nav-refraction["']\)/)
    expect(flowStyles).toMatch(/backdrop-filter:\s*url\(["']#yachiyo-flow-control-refraction["']\)/)
    expect(flowStyles).toMatch(/backdrop-filter:\s*url\(["']#yachiyo-flow-composer-refraction["']\)/)
    expect(shellStyles).not.toMatch(/data-yachiyo-appearance=["']liquid-glass["']/)
    expect(shellStyles).not.toMatch(/\.yachiyo-mobile-shell\s+\.rounded-(?:md|xl)/)
  })

  it('ships all light and dark environments within the APK budget', () => {
    const environmentRoot = path.join(assetRoot, 'environments')
    const opticsRoot = path.join(assetRoot, 'optics')
    const environmentFiles = fs.readdirSync(environmentRoot).filter((name) => name.endsWith('.webp'))
    const allFiles = [
      ...environmentFiles.map((name) => path.join(environmentRoot, name)),
      ...fs.readdirSync(opticsRoot).map((name) => path.join(opticsRoot, name)),
    ]

    expect(environmentFiles).toHaveLength(8)
    for (const filename of environmentFiles) {
      expect(fs.statSync(path.join(environmentRoot, filename)).size).toBeLessThanOrEqual(250 * 1024)
    }
    expect(allFiles.reduce((total, filename) => total + fs.statSync(filename).size, 0)).toBeLessThanOrEqual(
      3 * 1024 * 1024
    )
  })

  it('reserves floating header and navigation clearance for settings and plugin content', () => {
    expect(flowStyles).toMatch(
      /\.yachiyo-settings-detail\s*{[^}]*padding-top:\s*calc\(var\(--flow-header-height\) \+ 10px\);[^}]*padding-bottom:\s*calc\(var\(--flow-nav-height\) \+ 12px\);/s
    )
    expect(flowStyles).toMatch(
      /\.yachiyo-plugin-page-host\s*{[^}]*padding-top:\s*calc\(var\(--flow-header-height\) \+ 18px\);[^}]*padding-bottom:\s*calc\(var\(--flow-nav-height\) \+ 32px\);/s
    )
  })

  it('keeps pager chrome visible and reserves navigation clearance below the chat composer', () => {
    const narrowStyles = sectionBetween('@media (max-width: 440px)', '@media (forced-colors: active)')

    expect(narrowStyles).toContain('.yachiyo-mobile-title-meta')
    expect(narrowStyles).not.toMatch(/\.yachiyo-mobile-title span\s*,/)
    expect(shellStyles).not.toMatch(/\.yachiyo-mobile-title span\s*\{[^}]*display:\s*none;/s)
    expect(inputBoxSource.match(/className="yachiyo-mobile-input-box-root shrink-0"/g)).toHaveLength(2)
    expect(flowStyles).toMatch(
      /\.yachiyo-mobile-shell \.yachiyo-mobile-input-box-root\s*\{[^}]*padding-bottom:\s*calc\(var\(--flow-nav-height\) \+ 16px\) !important;/s
    )
    expect(flowStyles).toMatch(
      /\.yachiyo-mobile-shell\s+\.yachiyo-task-composer\s+\.yachiyo-mobile-input-box-root\s*\{[^}]*padding-bottom:\s*0 !important;/s
    )
  })

  it('keeps critical absolute layout compatible with Android 11 WebView', () => {
    expect(viteConfigSource).toContain("cssTarget: isMobile ? 'chrome83' : undefined")
    const mobileContentRule = flowStyles.match(/\.yachiyo-mobile-content\s*\{([^}]*)\}/s)?.[1] ?? ''
    const mainTabPageRule = shellStyles.match(/\.yachiyo-main-tab-page\s*\{([^}]*)\}/s)?.[1] ?? ''
    const bottomNavRule = flowStyles.match(/\.yachiyo-bottom-nav\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(mobileContentRule).toMatch(/top:\s*0;[^]*right:\s*0;[^]*bottom:\s*0;[^]*left:\s*0;/)
    expect(mainTabPageRule).toMatch(/top:\s*0;[^]*right:\s*0;[^]*bottom:\s*0;[^]*left:\s*0;/)
    expect(bottomNavRule).toMatch(/top:\s*auto;[^]*right:\s*0;[^]*bottom:\s*0;[^]*left:\s*0;/)
    expect(mobileContentRule).not.toMatch(/(?:^|\s)inset\s*:/)
    expect(mainTabPageRule).not.toMatch(/(?:^|\s)inset\s*:/)
    expect(bottomNavRule).not.toMatch(/(?:^|\s)inset\s*:/)
  })

  it('keeps the Releases action as a low-emphasis inline action instead of stacked glass', () => {
    const classIndex = workspaceSource.indexOf('className="yachiyo-about-release-action"')
    const actionStart = workspaceSource.lastIndexOf('<UnstyledButton', classIndex)
    const actionEnd = workspaceSource.indexOf('</UnstyledButton>', classIndex)

    expect(classIndex).toBeGreaterThanOrEqual(0)
    expect(actionStart).toBeGreaterThanOrEqual(0)
    expect(actionEnd).toBeGreaterThan(actionStart)

    const releaseAction = workspaceSource.slice(actionStart, actionEnd + '</UnstyledButton>'.length)
    expect(releaseAction).not.toMatch(/<Button\b/)
    expect(releaseAction).not.toContain('variant="light"')
    expect(releaseAction).toContain("aria-label={String(t('查看 Releases'))}")
    expect(releaseAction).toContain('<IconExternalLink')
    expect(releaseAction).toContain('needCheckUpdate ? YACHIYO_LATEST_RELEASE_URL : YACHIYO_RELEASES_URL')
    expect(shellStyles).toMatch(
      /\.yachiyo-status-value \.yachiyo-about-release-action\s*{[^}]*min-height:\s*44px;[^}]*border-radius:\s*16px;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s
    )
    expect(flowStyles).toMatch(
      /\.yachiyo-about-release-action\s*{[^}]*color:\s*var\(--flow-blue\);[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s
    )
  })

  it('removes every theme material effect in reduced quality', () => {
    const reducedStyles = sectionBetween(
      '/* Balanced retains stable blur; reduced keeps translucent layering without expensive blur. */',
      '@supports not ((backdrop-filter: blur(1px))'
    )

    for (const token of [
      '--flow-chrome-fill',
      '--flow-control-fill',
      '--flow-popover-fill',
      '--flow-sheet-fill',
      '--flow-group-fill',
      '--flow-content-fill',
    ]) {
      expect(reducedStyles, `${token} must retain a translucent no-blur fallback`).toMatch(
        new RegExp(`${token}: rgba\\(\\d+, \\d+, \\d+, 0\\.\\d+\\);`)
      )
    }
    for (const selector of materialSelectors) {
      expect(reducedStyles, `${selector} must downgrade in reduced quality`).toContain(selector)
    }
    expect(reducedStyles).toMatch(/backdrop-filter:\s*none !important;/)
    expect(reducedStyles).toMatch(/-webkit-backdrop-filter:\s*none !important;/)
    expect(reducedStyles).toMatch(/filter:\s*none !important;/)
    expect(reducedStyles).toMatch(
      /\[data-yachiyo-liquid-glass-quality=['"]reduced['"]\]\s+body \*\s*\{[^}]*backdrop-filter:\s*none !important;[^}]*-webkit-backdrop-filter:\s*none !important;/s
    )
    expect(reducedStyles).toMatch(
      /\[data-yachiyo-liquid-glass-quality=['"]reduced['"]\]\s*\.yachiyo-bottom-nav-lens-inner\s*\{[^}]*background:\s*var\(--flow-control-fill\) !important;/s
    )
    expect(reducedStyles).not.toMatch(/url\(["']#yachiyo-flow-/)
  })

  it('lets transparency, contrast, and forced-color preferences override full-quality refraction', () => {
    const preferenceStyles = sectionBetween(
      '/* Accessibility preferences must override full-quality SVG refraction as well as ordinary blur. */',
      '@media (prefers-reduced-motion: reduce)'
    )

    expect(preferenceStyles).toContain('(prefers-reduced-transparency: reduce)')
    expect(preferenceStyles).toContain('(prefers-contrast: more)')
    expect(preferenceStyles).toContain('(forced-colors: active)')
    for (const selector of materialSelectors) {
      expect(preferenceStyles, `${selector} must honor accessibility material fallbacks`).toContain(selector)
    }
    expect(preferenceStyles).toMatch(/backdrop-filter:\s*none !important;/)
    expect(preferenceStyles).toMatch(/filter:\s*none !important;/)
    expect(preferenceStyles).toMatch(/border-width:\s*2px !important;/)
  })

  it('uses system colors for every material in forced-colors mode', () => {
    const forcedColorStyles = sectionBetween('@media (forced-colors: active)', '@media (orientation: landscape)')

    for (const selector of materialSelectors) {
      expect(forcedColorStyles, `${selector} must use forced system colors`).toContain(selector)
    }
    expect(forcedColorStyles).toContain('border: 1px solid CanvasText !important;')
    expect(forcedColorStyles).toContain('color: CanvasText !important;')
    expect(forcedColorStyles).toContain('background: Canvas !important;')
    expect(forcedColorStyles).toContain('forced-color-adjust: auto;')
  })
})
