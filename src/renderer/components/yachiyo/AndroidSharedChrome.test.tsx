/** @vitest-environment jsdom */

import { render, within } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { describe, expect, it } from 'vitest'
import {
  AndroidInteractiveChrome,
  AndroidSharedChromeHostProvider,
  AndroidStandardChromeLayer,
} from './AndroidSharedChrome'
import type { AndroidTabTransitionSnapshot } from './AndroidMainTabPager'
import { AndroidPagerPagePresentationProvider } from './android-pager-page-presentation'

function transition(progress = 0.25): AndroidTabTransitionSnapshot {
  return {
    sourceId: 'chat',
    sourceIndex: 0,
    targetId: 'interactive',
    targetIndex: 1,
    progress: motionValue(progress),
    velocity: motionValue(0),
    direction: 1,
    requestSource: 'drag',
    transactionId: 1,
  }
}

describe('AndroidSharedChrome', () => {
  it('portals source and target interactive chrome into one host using the shared pager progress', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const pagerTransition = transition()

    const { container } = render(
      <AndroidSharedChromeHostProvider host={host}>
        <AndroidPagerPagePresentationProvider
          value={{ role: 'source', transitioning: true, direction: 1, progress: pagerTransition.progress }}
        >
          <AndroidInteractiveChrome>Source chrome</AndroidInteractiveChrome>
        </AndroidPagerPagePresentationProvider>
        <AndroidPagerPagePresentationProvider
          value={{ role: 'target', transitioning: true, direction: 1, progress: pagerTransition.progress }}
        >
          <AndroidInteractiveChrome>Target chrome</AndroidInteractiveChrome>
        </AndroidPagerPagePresentationProvider>
      </AndroidSharedChromeHostProvider>
    )

    expect(container.querySelector('.yachiyo-interactive-header')).toBeNull()
    const layers = host.querySelectorAll<HTMLElement>('.yachiyo-interactive-header')
    expect(layers).toHaveLength(2)
    expect(layers[0].style.opacity).toBe('0.75')
    expect(layers[1].style.opacity).toBe('0.25')
    expect(layers[1].inert).toBe(true)
    expect(within(host).getByText('Target chrome').closest('header')?.getAttribute('aria-hidden')).toBe('true')
    host.remove()
  })

  it('fades the standard chrome as interactive becomes the target', () => {
    const pagerTransition = transition()
    const { container } = render(
      <AndroidStandardChromeLayer activeInteractive={false} transition={pagerTransition}>
        Standard chrome
      </AndroidStandardChromeLayer>
    )

    const layer = container.querySelector<HTMLElement>('.yachiyo-shared-standard-chrome')
    expect(layer?.style.opacity).toBe('0.75')
    expect(layer?.style.pointerEvents).toBe('none')
  })
})
