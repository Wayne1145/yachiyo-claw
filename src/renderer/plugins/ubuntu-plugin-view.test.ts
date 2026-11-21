import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parsePluginView } from '@shared/plugins/view-schema'
import { bundleUbuntuPlugin } from '../../../scripts/bundle-ubuntu-plugin.mjs'

let source: string
beforeAll(async () => { source = await bundleUbuntuPlugin() })

function loadPage(status: object, exitCode = 0, receipt: object = {}) {
  const tools = new Map<string, () => Promise<unknown>>()
  const hostCall = vi.fn(async (method: string, _args: unknown) => {
    if (method === 'linux.install') return receipt
    if (method === 'linux.exec') return { stdout: 'Ubuntu 24.04\nPython 3.12\nNode.js v18\ngit version 2.43', stderr: '', exitCode }
    return status
  })
  runInNewContext(source, { Date, yachiyo: { host: { call: hostCall }, registerTool: (name: string, run: () => Promise<unknown>) => tools.set(name, run) } })
  return { hostCall, invoke: async (name: string) => parsePluginView(await tools.get(name)!()) }
}

describe('official Ubuntu plugin management page', () => {
  it('renders live download bytes with a refresh hint and no duplicate install button', async () => {
    const page = loadPage({ state: 'downloading', download: { bytesDownloaded: 10, bytesTotal: 100 } })
    const { children } = await page.invoke('render')
    expect(children).toContainEqual(expect.objectContaining({ key: 'ubuntu-install-active', label: '正在下载镜像' }))
    expect(children).toContainEqual(expect.objectContaining({ type: 'progress', value: 10 }))
    expect(children.some((node) => node.key === 'install')).toBe(false)
  })

  it.each([
    [{ state: 'paused' }, '下载已暂停', '继续下载'],
    [{ state: 'configuring', installed: true, error: 'ubuntu_toolchain_failed' }, '安装失败', '重试安装'],
  ] as const)('can recover from %o', async (status, state, action) => {
    const { children } = await loadPage(status).invoke('render')
    expect(children).toContainEqual(expect.objectContaining({ key: 'state', label: state }))
    expect(children).toContainEqual(expect.objectContaining({ key: 'install', label: action }))
    if ('error' in status) expect(children).toContainEqual(expect.objectContaining({ key: 'error', content: expect.stringContaining(status.error) }))
  })

  const history = { status: 'completed', bytesDownloaded: 100, bytesTotal: 100, retainedPayload: false, error: 'obsolete' }
  it.each([
    [{ state: 'not_downloaded', installed: false, download: history }, '未安装'],
    [{ state: 'completed', installed: false, download: history }, '未安装'],
    [{ state: 'completed', installed: true, download: history }, '开发工具等待配置'],
    [{ state: 'extracting', installed: false, download: history }, '正在解压镜像'],
    [{ state: 'configuring', installed: true, download: history }, '正在配置开发工具'],
    [{ state: 'failed', installed: true, error: 'apt_failure', download: history }, '安装失败'],
    [{ state: 'ready', ready: true, installed: true, download: history }, '安装成功 · 环境可用'],
    [{ state: 'ready', ready: false, installed: false, download: history }, '未安装'],
  ] as const)('keeps the actual install phase and hides consumed download bytes for %o', async (status, label) => {
    const { children } = await loadPage(status).invoke('render')
    expect(children).toContainEqual(expect.objectContaining({ type: 'badge', label }))
    expect(children.some((node) => node.type === 'progress')).toBe(false)
    expect(children.some((node) => node.key === 'verify')).toBe(label === '安装成功 · 环境可用')
  })

  it('displays an accepted request across idle polls, then yields to progress or failure', async () => {
    const status = { state: 'not_downloaded', installed: false, download: history, error: '' }
    const page = loadPage(status, 0, { accepted: true, state: 'downloading' })
    for (const action of ['install', 'render']) {
      const { children } = await page.invoke(action)
      expect(children).toContainEqual(expect.objectContaining({ key: 'ubuntu-install-active', label: '正在下载镜像' }))
      expect(children.some((node) => node.key === 'install' || node.type === 'progress')).toBe(false)
    }
    status.state = 'extracting'
    expect((await page.invoke('render')).children).toContainEqual(expect.objectContaining({ label: '正在解压镜像' }))
    status.error = 'ubuntu_archive_invalid'
    const failed = (await page.invoke('render')).children
    expect(failed).toContainEqual(expect.objectContaining({ label: '安装失败' }))
    expect(failed).toContainEqual(expect.objectContaining({ content: expect.stringContaining('ubuntu_archive_invalid') }))
    expect(page.hostCall.mock.calls.filter(([method]) => method === 'linux.install')).toHaveLength(1)
  })

  it('expires a stale acknowledgement and never infers a successful install from acceptance', async () => {
    vi.useFakeTimers()
    try {
      const page = loadPage({ state: 'not_downloaded', installed: false }, 0, { accepted: true, state: 'installing' })
      expect((await page.invoke('install')).children).toContainEqual(expect.objectContaining({ label: '正在安装根文件系统' }))
      vi.advanceTimersByTime(16000)
      expect((await page.invoke('render')).children).toContainEqual(expect.objectContaining({ label: '未安装' }))
      const stale = loadPage({ state: 'not_downloaded', installed: false }, 0, { accepted: true, state: 'ready' })
      expect((await stale.invoke('install')).children).toContainEqual(expect.objectContaining({ label: '未安装' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('only verifies a ready runtime, using one fixed Ubuntu host command, and displays the output and exit code result', async () => {
    const unavailable = loadPage({ state: 'not_downloaded' })
    expect((await unavailable.invoke('verify_environment')).children.some((node) => node.key === 'verify')).toBe(false)
    expect(unavailable.hostCall).toHaveBeenCalledTimes(1)
    for (const exitCode of [0, 2]) {
      const ready = loadPage({ ready: true, installed: true }, exitCode)
      const { children } = await ready.invoke('verify_environment')
      expect(ready.hostCall).toHaveBeenCalledTimes(2)
      expect(ready.hostCall).toHaveBeenLastCalledWith('linux.exec', { command: expect.stringMatching(/\/etc\/os-release.*python3 --version.*node --version.*git --version/), timeoutMs: 45000 })
      expect(children).toContainEqual(expect.objectContaining({ key: 'verification-output', content: expect.stringContaining('Ubuntu 24.04') }))
      expect(children).toContainEqual(expect.objectContaining({ key: 'verification-state', tone: exitCode === 0 ? 'success' : 'error' }))
    }
  })
})
