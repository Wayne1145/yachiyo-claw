/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AndroidSettingsStackSurface } from './AndroidSettingsStackSurface'

vi.mock('@/router', () => ({
  router: { navigate: vi.fn() },
}))

describe('AndroidSettingsStackSurface', () => {
  it('makes retained settings pages inert when a detail page becomes active', async () => {
    const { container, rerender } = render(
      <AndroidSettingsStackSurface pathname="/settings">
        <button type="button">Settings home action</button>
      </AndroidSettingsStackSurface>
    )

    rerender(
      <AndroidSettingsStackSurface pathname="/settings/themes">
        <button type="button">Theme action</button>
      </AndroidSettingsStackSurface>
    )

    await waitFor(() => {
      const retainedPage = container.querySelector<HTMLElement>('[data-settings-path="/settings"]')
      const activePage = container.querySelector<HTMLElement>('[data-settings-path="/settings/themes"]')

      expect(retainedPage?.getAttribute('aria-hidden')).toBe('true')
      expect(retainedPage?.inert).toBe(true)
      expect(activePage?.getAttribute('aria-hidden')).toBe('false')
      expect(activePage?.inert).toBe(false)
    })
  })
})
