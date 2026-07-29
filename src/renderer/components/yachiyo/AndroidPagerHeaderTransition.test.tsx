/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { describe, expect, it } from 'vitest'
import type { AndroidTabTransitionSnapshot } from './AndroidMainTabPager'
import { AndroidPagerHeaderActions, AndroidPagerHeaderTitle } from './AndroidPagerHeaderTransition'

function createTransition(progressValue: number): AndroidTabTransitionSnapshot {
  return {
    sourceId: 'chat',
    sourceIndex: 0,
    targetId: 'settings',
    targetIndex: 1,
    progress: motionValue(progressValue),
    velocity: motionValue(900),
    direction: 1,
    requestSource: 'drag',
    transactionId: 1,
  }
}

describe('AndroidPagerHeaderTransition', () => {
  it('crossfades without translating titles or actions when motion is reduced', () => {
    const transition = createTransition(0.5)
    const { container } = render(
      <>
        <AndroidPagerHeaderTitle
          title="聊天"
          subtitle="会话"
          targetTitle="Yachiyo Claw"
          targetSubtitle="设置"
          connected
          transition={transition}
          reducedMotion
        />
        <AndroidPagerHeaderActions transition={transition} reducedMotion>
          <button type="button">操作</button>
        </AndroidPagerHeaderActions>
      </>
    )

    const titleLayers = container.querySelectorAll<HTMLElement>('.yachiyo-pager-header-title-layer')
    expect(titleLayers).toHaveLength(2)
    expect(titleLayers[0].style.transform).toBe('translate3d(0, 0, 0)')
    expect(titleLayers[1].style.transform).toBe('translate3d(0, 0, 0)')
    expect((container.querySelector('button')?.parentElement as HTMLElement).style.transform).toBe(
      'translate3d(0, 0, 0)'
    )
    const actionWrapper = container.querySelector('.yachiyo-pager-header-actions')
    expect(actionWrapper).not.toBeNull()
    expect(actionWrapper?.contains(container.querySelector('button'))).toBe(true)
  })
})
