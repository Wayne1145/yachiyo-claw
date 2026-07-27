// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
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

  it('does not load plugin code while the global feature is disabled', async () => {
    const previous = settingsStore.getState().featureOverrides
    settingsStore.setState({ featureOverrides: { ...previous, plugins: false } })
    try {
      render(
        <MantineProvider>
          <PluginPageHost pluginId="demo-plugin" />
        </MantineProvider>
      )

      expect(await screen.findByText('插件功能已关闭')).toBeTruthy()
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

      expect(await screen.findByText('插件页面渲染失败')).toBeTruthy()
      expect(screen.getByText('plugin_render_boom')).toBeTruthy()
      expect(mocks.recordUiFailure).toHaveBeenCalledWith('demo-plugin', expect.any(Error))
    } finally {
      consoleError.mockRestore()
    }
  })
})
