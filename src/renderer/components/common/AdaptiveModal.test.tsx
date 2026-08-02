/** @vitest-environment jsdom */
import { MantineProvider } from '@mantine/core'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AndroidAppShellContext } from '@/components/yachiyo/AndroidAppShellContext'
import { AdaptiveModal } from './AdaptiveModal'

const adaptiveModalTestState = vi.hoisted(() => ({
  isSmallScreen: false,
}))

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen: () => adaptiveModalTestState.isSmallScreen,
}))

vi.mock('vaul', async () => {
  const { createElement, Fragment } = await import('react')
  const PassThrough = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children)

  return {
    Drawer: {
      Content: PassThrough,
      Handle: () => null,
      Overlay: () => null,
      Portal: PassThrough,
      Root: PassThrough,
    },
  }
})

const resizeCallbacks = new Set<ResizeObserverCallback>()

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeCallbacks.add(callback)
  }

  observe() {}
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.callback)
  }
}

describe('AdaptiveModal.Actions', () => {
  let modalClientWidth = 0
  let clientWidthDescriptor: PropertyDescriptor | undefined
  let scrollWidthDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    resizeCallbacks.clear()
    adaptiveModalTestState.isSmallScreen = false
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    )
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('yachiyo-adaptive-modal-actions') ? modalClientWidth : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (!element.classList.contains('yachiyo-adaptive-modal-actions')) return 0
        if (element.dataset.density === 'comfortable') return 280
        if (element.dataset.density === 'compact') return 220
        return 160
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    }
    if (scrollWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor)
    }
  })

  it('preserves the existing desktop action layout outside the Android shell', () => {
    const { container } = render(
      <MantineProvider>
        <AdaptiveModal.Actions>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </AdaptiveModal.Actions>
      </MantineProvider>
    )

    expect(container.querySelector('.yachiyo-adaptive-modal-actions')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement).toBe(
      screen.getByRole('button', { name: 'Save' }).parentElement
    )
  })

  it('adds independently projected action slots inside the Android shell', () => {
    const { container } = render(
      <MantineProvider>
        <AndroidAppShellContext.Provider value={true}>
          <AdaptiveModal.Actions>
            <button type="button">Cancel</button>
            <button type="button">Save</button>
          </AdaptiveModal.Actions>
        </AndroidAppShellContext.Provider>
      </MantineProvider>
    )

    const actions = container.querySelector('.yachiyo-adaptive-modal-actions')
    expect(actions).toBeTruthy()
    expect(actions?.querySelectorAll('.yachiyo-adaptive-modal-action')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement?.className).toContain(
      'yachiyo-adaptive-modal-action'
    )
  })

  it('stacks actions from measured overflow and restores the horizontal density with hysteresis', async () => {
    modalClientWidth = 180
    const { container } = render(
      <MantineProvider>
        <AndroidAppShellContext.Provider value={true}>
          <AdaptiveModal.Actions>
            <button type="button">Keep approval</button>
            <button type="button">Continue with the understood risk</button>
          </AdaptiveModal.Actions>
        </AndroidAppShellContext.Provider>
      </MantineProvider>
    )

    const actions = container.querySelector<HTMLElement>('.yachiyo-adaptive-modal-actions')
    await waitFor(() => expect(actions?.dataset.density).toBe('overflow'))

    modalClientWidth = 400
    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
    })
    await waitFor(() => expect(actions?.dataset.density).toBe('comfortable'))
  })
})
