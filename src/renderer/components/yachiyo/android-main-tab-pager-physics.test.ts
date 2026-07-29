import { describe, expect, it } from 'vitest'
import {
  androidPagerIndexDeltaForOffset,
  appendAndroidPagerSample,
  clampAndroidPagerVisualOffset,
  estimateAndroidPagerVelocity,
  projectAndroidPagerOffset,
  resolveAndroidPagerAxis,
  resolveAndroidPagerTargetIndex,
  rubberBandAndroidPagerOffset,
  shouldCommitAndroidPagerTransition,
} from './android-main-tab-pager-physics'

describe('Android main tab pager physics', () => {
  it('locks only a confident horizontal gesture', () => {
    expect(resolveAndroidPagerAxis(9, 0)).toBe('pending')
    expect(resolveAndroidPagerAxis(10, 7)).toBe('horizontal')
    expect(resolveAndroidPagerAxis(10, 9)).toBe('vertical')
    expect(resolveAndroidPagerAxis(3, 12)).toBe('vertical')
  })

  it('keeps a bounded 80ms velocity history and estimates px/s', () => {
    let samples = appendAndroidPagerSample([], { position: 0, time: 0 })
    samples = appendAndroidPagerSample(samples, { position: 10, time: 20 })
    samples = appendAndroidPagerSample(samples, { position: 30, time: 40 })
    samples = appendAndroidPagerSample(samples, { position: 60, time: 60 })
    samples = appendAndroidPagerSample(samples, { position: 100, time: 80 })
    samples = appendAndroidPagerSample(samples, { position: 150, time: 100 })

    expect(samples).toHaveLength(5)
    expect(samples[0].time).toBe(20)
    expect(estimateAndroidPagerVelocity(samples)).toBeGreaterThan(1700)
    expect(
      estimateAndroidPagerVelocity([
        { position: 0, time: 0 },
        { position: 1000, time: 1 },
      ])
    ).toBe(2500)
  })

  it('projects momentum and commits by distance or a deliberate flick', () => {
    expect(projectAndroidPagerOffset(-40, -600)).toBeLessThan(-90)
    expect(shouldCommitAndroidPagerTransition({ offset: -120, velocity: 0, width: 360 })).toBe(true)
    expect(shouldCommitAndroidPagerTransition({ offset: -18, velocity: -650, width: 360 })).toBe(true)
    expect(shouldCommitAndroidPagerTransition({ offset: -10, velocity: -900, width: 360 })).toBe(false)
    expect(shouldCommitAndroidPagerTransition({ offset: -80, velocity: 900, width: 360 })).toBe(false)
    expect(shouldCommitAndroidPagerTransition({ offset: -150, velocity: 900, width: 360 })).toBe(false)
  })

  it('applies rising resistance at the first and last page', () => {
    expect(rubberBandAndroidPagerOffset(0, 360)).toBe(0)
    expect(rubberBandAndroidPagerOffset(100, 360)).toBeGreaterThan(0)
    expect(rubberBandAndroidPagerOffset(100, 360)).toBeLessThan(100)
    expect(rubberBandAndroidPagerOffset(-100, 360)).toBe(-rubberBandAndroidPagerOffset(100, 360))
  })

  it('limits visible spring overshoot to two pixels at both corridor ends', () => {
    expect(clampAndroidPagerVisualOffset(-400, -360)).toBe(-362)
    expect(clampAndroidPagerVisualOffset(24, -360)).toBe(2)
    expect(clampAndroidPagerVisualOffset(400, 360)).toBe(362)
    expect(clampAndroidPagerVisualOffset(-24, 360)).toBe(-2)
  })

  it('mirrors visual direction in RTL and moves only one adjacent index', () => {
    expect(androidPagerIndexDeltaForOffset(-30, false)).toBe(1)
    expect(androidPagerIndexDeltaForOffset(-30, true)).toBe(-1)
    expect(resolveAndroidPagerTargetIndex({ sourceIndex: 1, offset: -30, itemCount: 4, rtl: false })).toBe(2)
    expect(resolveAndroidPagerTargetIndex({ sourceIndex: 1, offset: -30, itemCount: 4, rtl: true })).toBe(0)
    expect(resolveAndroidPagerTargetIndex({ sourceIndex: 0, offset: 30, itemCount: 4, rtl: false })).toBeUndefined()
  })
})
