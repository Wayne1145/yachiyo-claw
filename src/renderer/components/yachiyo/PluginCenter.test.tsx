/** @vitest-environment jsdom */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { InstalledPluginRecord } from '@/plugins/installer'
import { PluginCenter } from './PluginCenter'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}),
  uninstall: vi.fn(async () => {}),
  loadMarketplace: vi.fn(async () => [] as unknown[]),
  resolvePackageSource: vi.fn(),
  downloadPackage: vi.fn(),
  installed: [] as InstalledPluginRecord[],
  pendingConsent: null as any,
  confirmInstall: vi.fn(async () => {}),
}))

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))
vi.mock('@/platform', () => ({ default: { getVersion: vi.fn(async () => '0.0.11') } }))
vi.mock('@/mobile/agent-broker', () => ({ readAgentAudit: () => [] }))
vi.mock('@/plugins/capacitor-stores', () => ({
  pluginDataStore: { usedBytes: vi.fn(async () => 1536) },
}))
vi.mock('@/plugins/package-source', () => ({
  DEFAULT_PLUGIN_MARKETPLACE_URL: 'https://example.com/plugins.json',
  downloadPluginPackage: mocks.downloadPackage,
  loadPluginMarketplace: mocks.loadMarketplace,
  marketplacePackage: vi.fn(),
  resolvePluginPackageSource: mocks.resolvePackageSource,
}))
vi.mock('@/plugins/plugin-manager', () => ({
  getPluginGrants: vi.fn(async () => []),
  pluginHealthStore: { get: vi.fn(async () => null) },
  readPluginAudit: () => [],
  reenableDisabledPlugin: vi.fn(async () => {}),
  setPluginGrant: vi.fn(async () => {}),
  usePluginStore: (selector: (state: unknown) => unknown) =>
    selector({
      installed: mocks.installed,
      pendingConsent: mocks.pendingConsent,
      refresh: mocks.refresh,
      requestInstall: vi.fn(),
      confirmInstall: mocks.confirmInstall,
      cancelInstall: vi.fn(),
      uninstall: mocks.uninstall,
      setEnabled: mocks.setEnabled,
      rollback: vi.fn(),
    }),
}))

function plugin(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'demo-plugin',
      displayName: 'Demo <script> plugin',
      description: 'A test plugin',
      version: '1.0.0',
      author: { name: 'Example Studio' },
      capabilities: [],
      contributions: {},
      files: [{ path: 'main.js', size: 2048, sha256: 'a'.repeat(64) }],
    },
    packageSha256: 'b'.repeat(64),
    signatureVerified: false,
    deviceGrantAllowed: false,
    source: 'sideload',
    installedAt: 1,
    enabled: true,
    ...overrides,
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  })
})

beforeEach(async () => {
  await i18n.changeLanguage('zh-Hans')
  mocks.installed = []
  mocks.refresh.mockClear()
  mocks.setEnabled.mockClear()
  mocks.uninstall.mockClear()
  mocks.loadMarketplace.mockReset().mockResolvedValue([])
  mocks.resolvePackageSource.mockReset()
  mocks.downloadPackage.mockReset()
  mocks.pendingConsent = null
  mocks.confirmInstall.mockClear()
})

function renderCenter() {
  return render(
    <MantineProvider>
      <PluginCenter />
    </MantineProvider>,
  )
}

describe('PluginCenter', () => {
  it('shows a safe bounded management summary and an honest unsigned status', async () => {
    mocks.installed = [plugin()]
    const { container } = renderCenter()

    expect(await screen.findByText('Demo <script> plugin')).toBeTruthy()
    expect(screen.getByText(/Example Studio/)).toBeTruthy()
    expect(screen.getByText(/本地侧载/)).toBeTruthy()
    expect(screen.getByText(/无法验证作者与下载完整性/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/代码 2\.0 KB · 数据 1\.5 KB/)).toBeTruthy())
    expect(screen.getByText('正常')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
  })

  it('offers disable-with-data and destructive uninstall as separate actions', async () => {
    const record = plugin()
    mocks.installed = [record]
    renderCenter()

    fireEvent.click(await screen.findByRole('button', { name: `卸载插件 ${record.manifest.displayName}` }))
    expect(await screen.findByText(/活动审计会保留/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '仅停用并保留数据' }))
    await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith('demo-plugin', false))
    expect(mocks.uninstall).not.toHaveBeenCalled()
  })

  it('checks marketplace updates without installing them automatically', async () => {
    mocks.installed = [plugin({ source: 'marketplace', signatureVerified: true, signerKeyId: 'official' })]
    mocks.loadMarketplace.mockResolvedValue([
      {
        id: 'demo-plugin',
        name: 'Demo',
        description: 'Update',
        version: '1.1.0',
      },
    ])
    renderCenter()

    fireEvent.click(await screen.findByRole('button', { name: '检查全部更新' }))
    expect(await screen.findByText('可更新至 v1.1.0')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('发现 1 个可用更新')
  })

  it('renders an empty state when no plugins are installed', async () => {
    renderCenter()
    expect(await screen.findByText('尚未安装任何插件')).toBeTruthy()
  })

  it('shows a Chinese message instead of a marketplace HTTP error code', async () => {
    mocks.loadMarketplace.mockRejectedValueOnce(new Error('plugin_marketplace_http_404'))
    renderCenter()

    fireEvent.click(screen.getByRole('button', { name: '浏览插件市场' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('插件市场地址不存在或尚未发布，请稍后重试。')
    expect(screen.queryByText('plugin_marketplace_http_404')).toBeNull()
  })

  it('shows a Chinese message instead of a plugin download HTTP error code', async () => {
    mocks.resolvePackageSource.mockRejectedValueOnce(new Error('plugin_package_probe_http_404'))
    renderCenter()

    fireEvent.change(screen.getByLabelText('HTTPS 或 GitHub 地址'), {
      target: { value: 'https://example.com/plugin.zip' },
    })
    fireEvent.click(screen.getByRole('button', { name: '下载并检查' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('插件下载地址不存在或文件已被移除，请检查地址后重试。')
    expect(screen.queryByText('plugin_package_probe_http_404')).toBeNull()
  })

  it('can select several capabilities before confirming installation', async () => {
    const record = plugin({
      manifest: {
        ...plugin().manifest,
        capabilities: [
          { name: 'ui', reason: 'Render a host-controlled plugin page safely.' },
          { name: 'storage', reason: 'Store plugin-specific state in its private namespace.' },
          { name: 'tools', reason: 'Expose a namespaced tool to the Agent runtime.' },
        ],
      },
    })
    mocks.pendingConsent = {
      verified: {
        manifest: record.manifest,
        files: new Map(),
        packageSha256: record.packageSha256,
        signatureVerified: false,
        deviceGrantAllowed: false,
        source: 'sideload',
        unpackedBytes: 1,
      },
      bytes: new Uint8Array([1]),
      preservedCapabilities: [],
    }
    renderCenter()

    fireEvent.click(await screen.findByRole('checkbox', { name: '插件页面(在 /plugin 内渲染界面)' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '本地存储(仅本插件的独立空间)' }))
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    await waitFor(() => expect(mocks.confirmInstall).toHaveBeenCalledWith(['ui', 'storage']))
  })
})
