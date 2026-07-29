import { describe, expect, it } from 'vitest'
import {
  appendAndroidHistorySwipeSample,
  estimateAndroidHistorySwipeVelocity,
  getAndroidHistoryActionWidth,
  projectAndroidHistorySwipeOffset,
  resolveAndroidHistorySwipeAxis,
  rubberBandAndroidHistoryOffset,
  shouldToggleAndroidHistorySwipe,
} from './android-conversation-swipe-physics'

describe('Android conversation history swipe physics', () => {
  it('derives the reveal width from 44px actions and 6px gaps', () => {
    expect(getAndroidHistoryActionWidth(0)).toBe(0)
    expect(getAndroidHistoryActionWidth(1)).toBe(44)
    expect(getAndroidHistoryActionWidth(4)).toBe(194)
  })

  it('waits for 10px and requires a 1.25 horizontal axis ratio', () => {
    expect(resolveAndroidHistorySwipeAxis(9, 0)).toBe('pending')
    expect(resolveAndroidHistorySwipeAxis(10, 8)).toBe('horizontal')
    expect(resolveAndroidHistorySwipeAxis(10, 8.1)).toBe('vertical')
    expect(resolveAndroidHistorySwipeAxis(2, 11)).toBe('vertical')
  })

  it('keeps at most five samples from the last 80ms and estimates regression velocity', () => {
    const samples = [0, 20, 40, 60, 80, 100].reduce(
      (history, time) => appendAndroidHistorySwipeSample(history, { position: time * 0.5, time }),
      [] as Array<{ position: number; time: number }>
    )
    expect(samples).toHaveLength(5)
    expect(samples[0].time).toBe(20)
    expect(estimateAndroidHistorySwipeVelocity(samples)).toBe(500)
    expect(appendAndroidHistorySwipeSample(samples, { position: 100, time: 181 }).map((sample) => sample.time)).toEqual(
      [181]
    )
    expect(
      estimateAndroidHistorySwipeVelocity([
        { position: 0, time: 0 },
        { position: 1000, time: 10 },
      ])
    ).toBe(2500)
  })

  it('projects release velocity with the 0.99 deceleration curve', () => {
    expect(projectAndroidHistorySwipeOffset(-40, -1000)).toBeCloseTo(-139, 5)
  })

  it('commits at 0.33 reveal progress or with an 18px 650px/s flick', () => {
    const actionWidth = getAndroidHistoryActionWidth(4)
    expect(
      shouldToggleAndroidHistorySwipe({
        sourceOpen: false,
        startOffset: 0,
        offset: -65,
        velocity: 0,
        actionWidth,
      })
    ).toBe(true)
    expect(
      shouldToggleAndroidHistorySwipe({
        sourceOpen: false,
        startOffset: 0,
        offset: -18,
        velocity: -650,
        actionWidth,
      })
    ).toBe(true)
    expect(
      shouldToggleAndroidHistorySwipe({
        sourceOpen: false,
        startOffset: 0,
        offset: -10,
        velocity: -900,
        actionWidth,
      })
    ).toBe(false)
    expect(
      shouldToggleAndroidHistorySwipe({
        sourceOpen: false,
        startOffset: 0,
        offset: -50,
        velocity: 900,
        actionWidth,
      })
    ).toBe(false)
    expect(
      shouldToggleAndroidHistorySwipe({
        sourceOpen: true,
        startOffset: -actionWidth,
        offset: -120,
        velocity: 0,
        actionWidth,
      })
    ).toBe(true)
  })

  it('applies progressive rubber-band resistance outside both reveal bounds', () => {
    const actionWidth = getAndroidHistoryActionWidth(4)
    expect(rubberBandAndroidHistoryOffset(-100, -actionWidth, 0, 320)).toBe(-100)
    const left = rubberBandAndroidHistoryOffset(-actionWidth - 100, -actionWidth, 0, 320)
    const right = rubberBandAndroidHistoryOffset(100, -actionWidth, 0, 320)
    expect(left).toBeLessThan(-actionWidth)
    expect(left).toBeGreaterThan(-actionWidth - 100)
    expect(right).toBeGreaterThan(0)
    expect(right).toBeLessThan(100)
  })
})
