/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX,
  resolveAdaptiveControlDensity,
  useAdaptiveControlDensity,
} from './useAdaptiveControlDensity'

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

function DensityHarness({ contentKey }: { contentKey?: string }) {
  const { containerRef, density, pointerHandlers } = useAdaptiveControlDensity<HTMLDivElement>({ contentKey })
  return <div ref={containerRef} data-testid="density" data-density={density} {...pointerHandlers} />
}

function RenderCountingDensityHarness({ onRender }: { onRender: () => void }) {
  onRender()
  const { containerRef, density } = useAdaptiveControlDensity<HTMLDivElement>()
  return <div ref={containerRef} data-testid="volatile-density" data-density={density} />
}

describe('adaptive control density', () => {
  let widths: Record<string, number>
  let clientWidthDescriptor: PropertyDescriptor | undefined
  let scrollWidthDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    resizeCallbacks.clear()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    widths = { comfortable: 90, compact: 80, overflow: 70 }
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 100
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return widths[(this as HTMLElement).dataset.density ?? 'comfortable'] ?? 0
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

  it('downgrades one level at a time when rendered controls overflow', () => {
    expect(
      resolveAdaptiveControlDensity({
        density: 'comfortable',
        measurement: { clientWidth: 100, scrollWidth: 101 },
        requiredWidths: {},
      })
    ).toBe('compact')
    expect(
      resolveAdaptiveControlDensity({
        density: 'compact',
        measurement: { clientWidth: 100, scrollWidth: 101 },
        requiredWidths: {},
      })
    ).toBe('overflow')
  })

  it('requires the full 12px recovery margin before increasing density', () => {
    const requiredWidths = { comfortable: 100 }
    expect(
      resolveAdaptiveControlDensity({
        density: 'compact',
        measurement: { clientWidth: 111, scrollWidth: 90 },
        requiredWidths,
      })
    ).toBe('compact')
    expect(
      resolveAdaptiveControlDensity({
        density: 'compact',
        measurement: { clientWidth: 100 + ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX, scrollWidth: 90 },
        requiredWidths,
      })
    ).toBe('comfortable')
  })

  it('defers a density change until every active pointer is released', async () => {
    render(<DensityHarness />)
    const cluster = screen.getByTestId('density')
    expect(cluster.dataset.density).toBe('comfortable')

    fireEvent.pointerDown(cluster, { pointerId: 7 })
    widths.comfortable = 140
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver)
      }
    })
    expect(cluster.dataset.density).toBe('comfortable')

    fireEvent.pointerUp(document.body, { pointerId: 7 })
    await waitFor(() => expect(cluster.dataset.density).toBe('compact'))
  })

  it('releases a pending measurement after pointer cancellation outside the container', async () => {
    render(<DensityHarness />)
    const cluster = screen.getByTestId('density')

    fireEvent.pointerDown(cluster, { pointerId: 9 })
    widths.comfortable = 140
    await act(async () => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver)
      }
    })
    expect(cluster.dataset.density).toBe('comfortable')

    fireEvent.pointerCancel(document.body, { pointerId: 9 })
    await waitFor(() => expect(cluster.dataset.density).toBe('compact'))
  })

  it('reprobes comfortable density when the rendered content signature changes', async () => {
    widths = { comfortable: 140, compact: 90, overflow: 70 }
    const { rerender } = render(<DensityHarness contentKey="long-labels" />)
    const cluster = screen.getByTestId('density')
    await waitFor(() => expect(cluster.dataset.density).toBe('compact'))

    widths.comfortable = 88
    rerender(<DensityHarness contentKey="short-labels" />)
    await waitFor(() => expect(cluster.dataset.density).toBe('comfortable'))
  })

  it('does not remeasure after every measurement-only render', async () => {
    let scrollWidth = 70
    let renderCount = 0
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        scrollWidth += 1
        return scrollWidth
      },
    })

    render(<RenderCountingDensityHarness onRender={() => renderCount++} />)

    await waitFor(() => expect(screen.getByTestId('volatile-density').dataset.density).toBe('comfortable'))
    expect(renderCount).toBeLessThanOrEqual(2)
  })
})
