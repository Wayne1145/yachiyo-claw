/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AndroidTabPagePreview,
  resolveAndroidTabPagePreview,
  type AndroidTabPreviewKind,
} from './AndroidTabPagePreview'

vi.mock('@/stores/chatStore', () => ({
  useSession: () => ({ session: { messages: [] }, isFetching: false }),
}))

vi.mock('@/stores/taskSessionStore', () => ({
  useTaskSessionRecord: () => ({ data: { messages: [] }, isFetching: false }),
}))

vi.mock('./AndroidSettingsStackSurface', () => ({
  AndroidSettingsStackSurface: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./AndroidSettingsHome', () => ({ AndroidSettingsHome: () => <div data-testid="settings-home" /> }))
vi.mock('./ThemeCenter', () => ({ ThemeCenter: () => <div data-testid="theme-center" /> }))
vi.mock('./PluginCenter', () => ({ PluginCenter: () => <div data-testid="plugin-center" /> }))
vi.mock('./LocalModelCenter', () => ({ LocalModelCenter: () => <div data-testid="local-model-center" /> }))
vi.mock('./DownloadsCenter', () => ({ DownloadsCenter: () => <div data-testid="downloads-center" /> }))
vi.mock('./YachiyoChatLanding', () => ({ YachiyoChatLanding: () => <div data-testid="chat-landing" /> }))

afterEach(cleanup)

describe('resolveAndroidTabPagePreview', () => {
  it.each<[string, AndroidTabPreviewKind]>([
    ['/settings/themes', 'settings-themes'],
    ['/settings/plugins', 'settings-plugins'],
    ['/settings/local-models', 'settings-local-models'],
    ['/settings/downloads', 'settings-downloads'],
  ])('keeps the saved settings destination %s instead of resolving the settings home', (pathname, kind) => {
    expect(
      resolveAndroidTabPagePreview({
        tab: 'settings',
        savedLocation: { pathname, search: {} },
        fallbackRoute: '/settings',
      })
    ).toMatchObject({ pathname, kind })
  })

  it.each<[string, AndroidTabPreviewKind, string | undefined]>([
    ['/session/chat-42', 'chat-session', 'chat-42'],
    ['/task/task-42', 'task-session', 'task-42'],
    ['/task', 'task-new', undefined],
    ['/develop', 'develop', undefined],
    ['/develop/project-42', 'develop', undefined],
  ])('resolves %s to a stable non-landing conversation preview', (pathname, kind, resourceId) => {
    const result = resolveAndroidTabPagePreview({
      tab: 'chat',
      savedLocation: { pathname, search: {} },
      fallbackRoute: '/',
    })
    expect(result).toMatchObject({ pathname, kind })
    expect(result.resourceId).toBe(resourceId)
    expect(result.kind).not.toBe('chat-landing')
  })

  it('renders a dedicated development destination preview', () => {
    const { container } = render(
      <AndroidTabPagePreview tab="develop" savedLocation={{ pathname: '/develop', search: {} }} fallbackRoute="/develop" />
    )

    expect(container.querySelector('[data-preview-kind="develop"]')).toBeTruthy()
    expect(container.querySelector('.coding-tab-preview')).toBeTruthy()
    expect(screen.getByText('手机开发')).toBeTruthy()
    expect(screen.queryByTestId('chat-landing')).toBeNull()
  })

  it('preserves saved interactive search and plugin child destinations', () => {
    const interactive = resolveAndroidTabPagePreview({
      tab: 'interactive',
      savedLocation: { pathname: '/interactive', search: { sessionId: 'session-7', mode: 'agent' } },
      fallbackRoute: '/interactive',
    })
    const plugin = resolveAndroidTabPagePreview({
      tab: 'plugin-weather',
      savedLocation: { pathname: '/plugin/weather/details', search: { city: 'Shanghai' } },
      fallbackRoute: '/plugin/weather',
    })

    expect(interactive.search).toEqual({ sessionId: 'session-7', mode: 'agent' })
    expect(plugin).toMatchObject({ kind: 'plugin-page', pathname: '/plugin/weather/details', resourceId: 'weather' })
    expect(plugin.search).toEqual({ city: 'Shanghai' })
  })
})

describe('AndroidTabPagePreview', () => {
  it.each([
    ['/settings/themes', 'theme-center'],
    ['/settings/plugins', 'plugin-center'],
    ['/settings/local-models', 'local-model-center'],
    ['/settings/downloads', 'downloads-center'],
  ])('renders the reusable page component for %s', (pathname, testId) => {
    const { container } = render(
      <AndroidTabPagePreview tab="settings" savedLocation={{ pathname, search: {} }} fallbackRoute="/settings" />
    )

    expect(screen.getByTestId(testId)).toBeTruthy()
    expect(screen.queryByTestId('settings-home')).toBeNull()
    expect(container.querySelector('[data-preview-path]')?.getAttribute('data-preview-path')).toBe(pathname)
  })

  it('renders saved chat and task paths without flashing the chat landing page', () => {
    const { container, rerender } = render(
      <AndroidTabPagePreview
        tab="chat"
        savedLocation={{ pathname: '/session/chat-42', search: {} }}
        fallbackRoute="/"
      />
    )
    expect(container.querySelector('[data-preview-kind="chat-session"]')).toBeTruthy()
    expect(screen.queryByTestId('chat-landing')).toBeNull()

    rerender(
      <AndroidTabPagePreview tab="chat" savedLocation={{ pathname: '/task/task-42', search: {} }} fallbackRoute="/" />
    )
    expect(container.querySelector('[data-preview-kind="task-session"]')).toBeTruthy()
    expect(screen.queryByTestId('chat-landing')).toBeNull()
  })
})
