// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import i18n from '@/i18n'
import { PluginPageHost, PluginViewErrorBoundary } from './PluginPageHost'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  invoke: vi.fn(),
  dispose: vi.fn(),
  recordUiFailure: vi.fn(),
}))

vi.mock('./plugin-manager', () => ({
  loadPluginForPage: mocks.load,
  invokeLoadedPluginTool: mocks.invoke,
  disposePluginRuntime: mocks.dispose,
  recordPluginUiFailure: mocks.recordUiFailure,
}))

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
})

describe('PluginPageHost actions', () => {
  beforeEach(() => {
    mocks.load.mockReset().mockResolvedValue({
      record: {
        manifest: { id: 'demo-plugin', displayName: 'Demo Plugin' },
        packageSha256: 'a'.repeat(64),
      },
      runtime: {},
      tools: [],
      uiGranted: true,
      view: {
        schemaVersion: 1,
        children: [
          {
            type: 'button',
            key: 'run',
            label: '运行',
            action: { type: 'invoke', handler: 'run' },
          },
        ],
      },
    })
    mocks.invoke.mockReset()
    mocks.dispose.mockReset()
    mocks.recordUiFailure.mockReset()
  })

  it('shows a direct permission entry when Ubuntu was installed without its runtime grant', async () => {
    mocks.load.mockResolvedValue({ uiGranted: true, missingUiCapability: 'linux-runtime', runtime: null })
    const { unmount } = render(<MantineProvider><PluginPageHost pluginId="missing-ubuntu-grant" /></MantineProvider>)
    expect(await screen.findByText(String(i18n.t('Ubuntu 运行环境未授权')))).toBeTruthy()
    expect(screen.getByRole('button', { name: String(i18n.t('权限与活动')) })).toBeTruthy()
    expect(mocks.invoke).not.toHaveBeenCalled()
    unmount()
  })

  it('keeps the installation page available after denial and coalesces install taps during approval', async () => {
    mocks.load.mockResolvedValue({
      uiGranted: true, runtime: {}, tools: [], record: { manifest: { id: 'ubuntu-runtime' }, packageSha256: 'a'.repeat(64) },
      view: { schemaVersion: 1, children: [{ type: 'button', key: 'install', label: '安装 Ubuntu', action: { type: 'invoke', handler: 'install' } }] },
    })
    let decline!: (error: Error) => void
    mocks.invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => { decline = reject }))
      .mockResolvedValueOnce({ schemaVersion: 1, children: [{ type: 'text', key: 'ok', content: 'queued' }] })
    const { unmount } = render(<MantineProvider><PluginPageHost pluginId="ubuntu-runtime" /></MantineProvider>)
    const install = await screen.findByRole('button', { name: '安装 Ubuntu' })
    fireEvent.click(install)
    fireEvent.click(install)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1))
    await act(async () => { decline(new Error('ubuntu_user_denied')) })
    expect(await screen.findByText(String(i18n.t('已取消本次操作。')))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '安装 Ubuntu' }))
    expect(await screen.findByText('queued')).toBeTruthy()
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('updates an installed 1.0.0 page automatically through stale download history and install completion', async () => {
    mocks.load.mockResolvedValue({
      uiGranted: true, runtime: {}, tools: [{ name: 'render' }], view: null,
      record: { manifest: { id: 'ubuntu-runtime', version: '1.0.0' }, signatureVerified: true, deviceGrantAllowed: true, packageSha256: 'a'.repeat(64) },
    })
    const idle = { state: 'not_downloaded', installed: false, download: { bytesTotal: 100, bytesDownloaded: 100, retainedPayload: false } }
    let status = idle as Record<string, unknown>
    mocks.invoke.mockImplementation(async (_id, _runtime, name) => name === 'ubuntu-runtime_status' ? status : null)
    const { unmount } = render(<MantineProvider><PluginPageHost pluginId="ubuntu-runtime" /></MantineProvider>)
    const install = await screen.findByRole('button', { name: '下载并安装' })
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(install)
    await screen.findByText('等待下载')
    status = { state: 'configuring', installed: true, ready: false }
    await screen.findByText('正在配置开发工具', undefined, { timeout: 4500 })
    status = { state: 'ready', installed: true, ready: true }
    await screen.findByText('安装成功 · 环境可用', undefined, { timeout: 4500 })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(mocks.invoke.mock.calls.filter((call) => call[2] === 'install')).toHaveLength(1)
    unmount()
  }, 12_000)

  it('serializes rapid actions without dropping or replaying them from a state updater', async () => {
    let active = 0
    let maxActive = 0
    mocks.invoke.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return { ok: true }
    })
    render(
      <MantineProvider>
        <PluginPageHost pluginId="demo-plugin" />
      </MantineProvider>
    )

    const button = await screen.findByRole('button', { name: '运行' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBe(1)
  })

  it('loads only a verified static view during preview and does not start page actions', async () => {
    mocks.load.mockResolvedValueOnce({
      record: {
        manifest: { id: 'preview-plugin', displayName: 'Preview Plugin' },
        packageSha256: 'b'.repeat(64),
      },
      runtime: {},
      tools: [{ name: 'render' }],
      uiGranted: true,
      view: {
        schemaVersion: 1,
        children: [
          {
            type: 'button',
            key: 'preview-run',
            label: '预览操作',
            action: { type: 'invoke', handler: 'run' },
          },
        ],
      },
    })
    render(
      <MantineProvider>
        <PluginPageHost pluginId="preview-plugin" activity="preview" />
      </MantineProvider>
    )

    const button = await screen.findByRole('button', { name: '预览操作' })
    expect(mocks.load).toHaveBeenCalledWith('preview-plugin', { startRuntime: false })
    fireEvent.click(button)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('does not abort an in-flight action when translations change', async () => {
    let signal: AbortSignal | undefined
    let finish: (() => void) | undefined
    mocks.invoke.mockImplementation(async (...args: unknown[]) => {
      signal = (args[5] as { abortSignal: AbortSignal }).abortSignal
      await new Promise<void>((resolve) => { finish = resolve })
      return { ok: true }
    })
    const previousLanguage = i18n.language
    const host = render(<MantineProvider><PluginPageHost pluginId="language-plugin" /></MantineProvider>)
    try {
      fireEvent.click(await screen.findByRole('button', { name: '运行' }))
      await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())
      await act(async () => { await i18n.changeLanguage(previousLanguage === 'en' ? 'zh-Hans' : 'en') })
      expect(signal?.aborted).toBe(false)
      expect(mocks.load).toHaveBeenCalledOnce()
    } finally {
      await act(async () => { finish?.(); await Promise.resolve() })
      host.unmount()
      await i18n.changeLanguage(previousLanguage || 'en')
    }
  })

  it('serializes runtime renders when two active Android hosts overlap during navigation', async () => {
    let active = 0
    let maxActive = 0
    mocks.load.mockResolvedValue({
      record: {
        manifest: { id: 'overlap-plugin', displayName: 'Overlap Plugin' },
        packageSha256: 'f'.repeat(64),
      },
      runtime: { isDisposed: () => false },
      tools: [{ name: 'render' }],
      uiGranted: true,
      view: null,
    })
    mocks.invoke.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return { schemaVersion: 1, children: [{ type: 'text', key: 'status', content: '可用' }] }
    })

    render(
      <MantineProvider>
        <PluginPageHost pluginId="overlap-plugin" activity="active" />
        <PluginPageHost pluginId="overlap-plugin" activity="active" />
      </MantineProvider>
    )

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBe(1)
    expect(screen.getAllByText('可用')).toHaveLength(2)
  })

  it('aborts the active action and drops queued actions when the page leaves active state', async () => {
    let activeSignal: AbortSignal | undefined
    mocks.load.mockResolvedValue({
      record: {
        manifest: { id: 'lifecycle-plugin', displayName: 'Lifecycle Plugin' },
        packageSha256: 'c'.repeat(64),
      },
      runtime: {},
      tools: [],
      uiGranted: true,
      view: {
        schemaVersion: 1,
        children: [
          {
            type: 'button',
            key: 'lifecycle-run',
            label: '生命周期操作',
            action: { type: 'invoke', handler: 'run' },
          },
        ],
      },
    })
    mocks.invoke.mockImplementation(
      async (...args: unknown[]) =>
        await new Promise((resolve, reject) => {
          activeSignal = (args[5] as { abortSignal?: AbortSignal }).abortSignal
          activeSignal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
    )
    const { rerender } = render(
      <MantineProvider>
        <PluginPageHost pluginId="lifecycle-plugin" activity="active" />
      </MantineProvider>
    )

    const button = await screen.findByRole('button', { name: '生命周期操作' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())

    rerender(
      <MantineProvider>
        <PluginPageHost pluginId="lifecycle-plugin" activity="preview" />
      </MantineProvider>
    )
    await waitFor(() => expect(activeSignal?.aborted).toBe(true))
    await Promise.resolve()
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })

  it('renders a cached view without retaining its old runtime', async () => {
    const oldRuntime = { id: 'old-runtime' }
    mocks.load.mockResolvedValueOnce({
      record: {
        manifest: { id: 'cache-plugin', displayName: 'Cache Plugin' },
        packageSha256: 'd'.repeat(64),
      },
      runtime: oldRuntime,
      tools: [],
      uiGranted: true,
      view: {
        schemaVersion: 1,
        children: [
          {
            type: 'button',
            key: 'cached-run',
            label: '缓存操作',
            action: { type: 'invoke', handler: 'run' },
          },
        ],
      },
    })
    const first = render(
      <MantineProvider>
        <PluginPageHost pluginId="cache-plugin" activity="active" />
      </MantineProvider>
    )
    await screen.findByRole('button', { name: '缓存操作' })
    first.unmount()

    let resolveReload: ((value: unknown) => void) | undefined
    const newRuntime = { id: 'new-runtime' }
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReload = resolve
        })
    )
    mocks.invoke.mockClear()
    render(
      <MantineProvider>
        <PluginPageHost pluginId="cache-plugin" activity="active" />
      </MantineProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '缓存操作' }))
    expect(mocks.invoke).not.toHaveBeenCalled()
    resolveReload?.({
      record: {
        manifest: { id: 'cache-plugin', displayName: 'Cache Plugin' },
        packageSha256: 'd'.repeat(64),
      },
      runtime: newRuntime,
      tools: [],
      uiGranted: true,
      view: {
        schemaVersion: 1,
        children: [
          {
            type: 'button',
            key: 'reloaded-run',
            label: '重新加载操作',
            action: { type: 'invoke', handler: 'run' },
          },
        ],
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: '重新加载操作' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())
    expect(mocks.invoke.mock.calls[0][1]).toBe(newRuntime)
  })

  it('does not load plugin code while the global feature is disabled', async () => {
    const previous = settingsStore.getState().featureOverrides
    settingsStore.setState({ featureOverrides: { ...previous, plugins: false } })
    try {
      render(
        <MantineProvider>
          <PluginPageHost pluginId="demo-plugin" />
        </MantineProvider>
      )

      expect(await screen.findByText('Plugins are disabled')).toBeTruthy()
      expect(mocks.load).not.toHaveBeenCalled()
      expect(mocks.dispose).toHaveBeenCalledWith('demo-plugin')
    } finally {
      settingsStore.setState({ featureOverrides: previous })
    }
  })

  it('contains plugin render errors locally instead of reaching the general error boundary', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const BrokenView = () => {
      throw new Error('plugin_render_boom')
    }
    try {
      render(
        <MantineProvider>
          <PluginViewErrorBoundary pluginId="demo-plugin">
            <BrokenView />
          </PluginViewErrorBoundary>
        </MantineProvider>
      )

      expect(await screen.findByText('Plugin page failed to render')).toBeTruthy()
      expect(screen.getByText('plugin_render_boom')).toBeTruthy()
      expect(mocks.recordUiFailure).toHaveBeenCalledWith('demo-plugin', expect.any(Error))
    } finally {
      consoleError.mockRestore()
    }
  })
})
