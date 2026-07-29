/** @vitest-environment jsdom */
import { MantineProvider } from '@mantine/core'
import { IconBolt, IconSettings } from '@tabler/icons-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdaptiveActionCluster,
  type AdaptiveActionDescriptor,
  getAdaptiveOverflowActionIds,
} from './AdaptiveActionCluster'

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

describe('AdaptiveActionCluster', () => {
  let clientWidthDescriptor: PropertyDescriptor | undefined
  let scrollWidthDescriptor: PropertyDescriptor | undefined
  let clusterClientWidth: number

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    resizeCallbacks.clear()
    clusterClientWidth = 100
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('yachiyo-adaptive-action-cluster') ? clusterClientWidth : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        const element = this as HTMLElement
        if (!element.classList.contains('yachiyo-adaptive-action-cluster')) {
          return 0
        }
        if (element.dataset.density === 'comfortable') {
          return 280
        }
        if (element.dataset.density === 'compact') {
          return 200
        }
        return 80
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

  it('moves lower-priority overflow actions first', () => {
    const actions: AdaptiveActionDescriptor[] = [
      {
        id: 'primary',
        label: 'Primary',
        icon: IconBolt,
        priority: 100,
        collapseStrategy: 'icon-then-overflow',
        menuAction: { onSelect: vi.fn() },
        renderControl: () => null,
      },
      {
        id: 'secondary',
        label: 'Secondary',
        icon: IconSettings,
        priority: 10,
        collapseStrategy: 'overflow',
        menuAction: { onSelect: vi.fn() },
        renderControl: () => null,
      },
    ]

    expect([...getAdaptiveOverflowActionIds(actions, 1)]).toEqual(['secondary'])
    expect([...getAdaptiveOverflowActionIds(actions, 2)]).toEqual(['secondary', 'primary'])
  })

  it('renders an action exactly once across the visible cluster and semantic overflow menu', async () => {
    const onSecondary = vi.fn()
    const actions: AdaptiveActionDescriptor[] = [
      {
        id: 'primary',
        label: 'Primary',
        icon: IconBolt,
        priority: 100,
        collapseStrategy: 'keep',
        renderControl: () => <button type="button">Primary</button>,
      },
      {
        id: 'secondary',
        label: 'Secondary',
        icon: IconSettings,
        priority: 10,
        collapseStrategy: 'icon-then-overflow',
        menuAction: { onSelect: onSecondary },
        renderControl: ({ presentation }) => (
          <button type="button" aria-label="Secondary">
            {presentation === 'labelled' ? 'Secondary' : <IconSettings aria-hidden />}
          </button>
        ),
      },
    ]

    const { container } = render(
      <MantineProvider>
        <AdaptiveActionCluster actions={actions} ariaLabel="Page actions" overflowLabel="More actions" />
      </MantineProvider>
    )

    const cluster = container.querySelector<HTMLElement>('.yachiyo-adaptive-action-cluster')
    await waitFor(() => expect(cluster?.dataset.density).toBe('overflow'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Secondary' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Primary' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const menuAction = await screen.findByRole('menuitem', { name: 'Secondary' })
    expect(screen.getAllByText('Secondary')).toHaveLength(1)
    fireEvent.click(menuAction)
    expect(onSecondary).toHaveBeenCalledOnce()
  })

  it('moves focus to the overflow trigger when the focused action is collected', async () => {
    clusterClientWidth = 400
    const actions: AdaptiveActionDescriptor[] = [
      {
        id: 'primary',
        label: 'Primary',
        icon: IconBolt,
        priority: 100,
        collapseStrategy: 'keep',
        renderControl: () => <button type="button">Primary</button>,
      },
      {
        id: 'secondary',
        label: 'Secondary',
        icon: IconSettings,
        priority: 10,
        collapseStrategy: 'icon-then-overflow',
        menuAction: { onSelect: vi.fn() },
        renderControl: ({ presentation }) =>
          presentation === 'labelled' ? (
            <button type="button">Secondary</button>
          ) : (
            <div role="button" tabIndex={0} aria-label="Secondary">
              <IconSettings aria-hidden />
            </div>
          ),
      },
    ]

    render(
      <MantineProvider>
        <AdaptiveActionCluster actions={actions} ariaLabel="Page actions" overflowLabel="More actions" />
      </MantineProvider>
    )
    screen.getByRole('button', { name: 'Secondary' }).focus()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Secondary' }))

    clusterClientWidth = 100
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver)
      }
    })

    const overflowButton = await screen.findByRole('button', { name: 'More actions' })
    await waitFor(() => expect(document.activeElement).toBe(overflowButton))
    expect(screen.queryByRole('button', { name: 'Secondary' })).toBeNull()
  })
})
