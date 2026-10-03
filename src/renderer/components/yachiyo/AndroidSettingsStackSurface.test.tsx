/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { createContext, createRef, useContext, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { router } from '@/router'
import {
  AndroidSettingsStackSurface,
  AndroidSettingsChromeTransition,
  type AndroidSettingsStackHandle,
} from './AndroidSettingsStackSurface'

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))
afterEach(cleanup)

describe('AndroidSettingsStackSurface', () => {
  it('replaces the chrome immediately without waiting for Animation.finished on old WebViews', () => {
    const { container, rerender } = render(
      <AndroidSettingsChromeTransition pathname="/settings" className="test-header">
        <span>Home title</span>
      </AndroidSettingsChromeTransition>
    )
    rerender(
      <AndroidSettingsChromeTransition pathname="/settings/themes" className="test-header">
        <span>Theme title</span>
      </AndroidSettingsChromeTransition>
    )
    expect(container.querySelectorAll('.yachiyo-settings-chrome-layer')).toHaveLength(1)
    expect(container.textContent).toBe('Theme title')
  })
  it('mounts one live route tree so historical Outlets cannot duplicate current forms or effects', () => {
    const route = createContext('/settings')
    const mounts = vi.fn()
    const unmounts = vi.fn()
    function LiveOutlet() {
      const current = useContext(route)
      useEffect(() => {
        mounts(current)
        return () => unmounts(current)
      }, [current])
      return <input aria-label={current} />
    }
    const page = (pathname: string) => (
      <route.Provider value={pathname}>
        <AndroidSettingsStackSurface pathname={pathname}>
          <LiveOutlet />
        </AndroidSettingsStackSurface>
      </route.Provider>
    )
    const { container, rerender } = render(page('/settings'))
    rerender(page('/settings/themes'))
    rerender(page('/settings/speech'))
    expect(container.querySelectorAll('input')).toHaveLength(1)
    expect(container.querySelectorAll('[data-settings-active="true"]')).toHaveLength(1)
    expect(mounts.mock.calls.map(([path]) => path)).toEqual(['/settings', '/settings/themes', '/settings/speech'])
    expect(unmounts).toHaveBeenCalledTimes(2)
  })

  it('returns through the settings history, preserves search parameters, and stops at the root', async () => {
    const ref = createRef<AndroidSettingsStackHandle>()
    const page = (path: string, search = {}) => (
      <AndroidSettingsStackSurface ref={ref} pathname={path} search={search}>
        <div />
      </AndroidSettingsStackSurface>
    )
    const { rerender } = render(page('/settings'))
    expect(ref.current?.canPop()).toBe(false)
    rerender(page('/settings/local-models', { view: 'installed' }))
    rerender(page('/settings/downloads'))
    await act(async () => {
      expect(await ref.current?.pop()).toBe(true)
    })
    expect(router.navigate).toHaveBeenLastCalledWith({
      to: '/settings/local-models',
      search: { view: 'installed' },
      replace: true,
    })
    rerender(page('/settings/local-models', { view: 'installed' }))
    await act(async () => {
      await ref.current?.pop()
    })
    expect(router.navigate).toHaveBeenLastCalledWith({ to: '/settings', search: {}, replace: true })
    rerender(page('/settings'))
    await act(async () => {
      expect(await ref.current?.pop()).toBe(false)
    })
  })
})
