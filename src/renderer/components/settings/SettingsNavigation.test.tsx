/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IconPuzzle } from '@tabler/icons-react'

const state = vi.hoisted(() => ({ enabled: true, allowPlugin: true, pathname: '/settings' }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props} />,
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/yachiyo/AndroidAppShellContext', () => ({ useInAndroidAppShell: () => true }))
vi.mock('@/features/builtin-features', () => ({ registerBuiltinFeatures: vi.fn() }))
vi.mock('@/features/builtin-feature-ui', () => ({ registerBuiltinFeatureUi: vi.fn() }))
vi.mock('@/features/feature-runtime', () => ({
  getEnabledFeatureIds: () => new Set(state.enabled ? ['plugins', 'speech'] : []),
  resolveRendererFeaturePlatform: () => 'android',
}))
vi.mock('@/features/ui-registry', () => ({
  getSettingsEntries: (group: string, { enabledFeatureIds }: { enabledFeatureIds: Set<string> }) =>
    group === 'app' && enabledFeatureIds.has('speech')
      ? [{ route: '/settings/speech', label: '语音服务', detail: 'ASR TTS', icon: IconPuzzle, order: 100 }]
      : [],
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (value: unknown) => unknown) => select({ featureOverrides: { speech: state.enabled } }),
}))
vi.mock('@/plugins/plugin-manager', () => ({
  usePluginStore: (select: (value: unknown) => unknown) =>
    select({
      installed: [
        {
          manifest: {
            id: 'demo',
            contributions: {
              settingsEntries: [
                { route: '/plugin/demo', label: 'Demo plugin', detail: 'Plugin preferences', group: 'app', order: 500 },
              ],
            },
          },
        },
      ],
      contributionPluginIds: state.allowPlugin ? ['demo'] : [],
    }),
}))

import { SettingsNavigation } from './SettingsNavigation'

afterEach(cleanup)
beforeEach(() => {
  state.enabled = true
  state.allowPlugin = true
  state.pathname = '/settings'
})

describe('settings navigation', () => {
  it('searches descriptions and keywords and restores all entries when cleared', () => {
    render(<SettingsNavigation />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '备份' } })
    expect(screen.getByRole('link', { name: /通用设置/ }).getAttribute('href')).toBe('/settings/general')
    expect(screen.queryByRole('link', { name: /主题外观/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(screen.getByRole('link', { name: /主题外观/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz-no-match' } })
    expect(screen.getByRole('status').textContent).toContain('没有找到相关设置')
    cleanup()
    render(<SettingsNavigation />)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('zzzz-no-match')
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
  })

  it('preserves feature gates and only shows approved plugin contributions', () => {
    state.enabled = false
    render(<SettingsNavigation />)
    expect(screen.queryByRole('link', { name: /语音服务/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Demo plugin/ })).toBeNull()
    cleanup()
    state.enabled = true
    state.allowPlugin = false
    render(<SettingsNavigation />)
    expect(screen.getByRole('link', { name: /语音服务/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Demo plugin/ })).toBeNull()
  })

  it('keeps plugin routes and the dedicated Yachiyo destination navigable', () => {
    state.pathname = '/settings/provider/yachiyo'
    render(<SettingsNavigation compact />)
    expect(screen.getByRole('link', { name: 'Yachiyo API' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '其他 API' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Demo plugin' }).getAttribute('href')).toBe('/plugin/demo')
  })
})
