import type { BrowserWindow } from 'electron'
import log from 'electron-log/main'

export function handleDeepLink(mainWindow: BrowserWindow, link: string) {
  const normalizedLink = link.replace(/^yachiyoclaw-dev:\/\//, 'yachiyoclaw://')
  const url = new URL(normalizedLink)

  if (url.protocol !== 'yachiyoclaw:') {
    log.warn('Rejected unsupported deep-link protocol')
    return
  }

  // Query strings can contain provider credentials; never include them in logs.
  log.info('Parsed Yachiyo deep link', { hostname: url.hostname, pathname: url.pathname })

  if (url.hostname === 'mcp' && url.pathname === '/install') {
    const encodedConfig = url.searchParams.get('server') || ''
    mainWindow.webContents.send('navigate-to', `/settings/mcp?install=${encodeURIComponent(encodedConfig)}`)
  }

  if (url.hostname === 'provider' && url.pathname === '/import') {
    const encodedConfig = url.searchParams.get('config') || ''
    mainWindow.webContents.send('navigate-to', `/settings/provider?import=${encodeURIComponent(encodedConfig)}`)
  }
}
