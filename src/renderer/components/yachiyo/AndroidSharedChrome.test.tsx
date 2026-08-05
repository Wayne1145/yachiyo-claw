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
  it('portals only active interactive chrome so a preview cannot intercept taps', () => {
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
    expect(layers).toHaveLength(1)
    expect(layers[0].style.opacity).toBe('0.75')
    expect(layers[0].inert).toBe(false)
    expect(layers[0].style.pointerEvents).toBe('auto')
    expect(within(host).queryByText('Target chrome')).toBeNull()
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
