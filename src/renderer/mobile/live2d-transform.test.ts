/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLive2DTransform,
  DEFAULT_LIVE2D_TRANSFORM,
  loadLive2DTransform,
  normalizeLive2DTransform,
  saveLive2DTransform,
} from './live2d-transform'

describe('Live2D transform persistence', () => {
  beforeEach(() => localStorage.clear())

  it('stores transforms per model and restores defaults after reset', () => {
    saveLive2DTransform('a', { offsetX: 0.2, offsetY: -0.1, scale: 1.4 })
    expect(loadLive2DTransform('a')).toEqual({ offsetX: 0.2, offsetY: -0.1, scale: 1.4 })
    expect(loadLive2DTransform('b')).toEqual(DEFAULT_LIVE2D_TRANSFORM)
    expect(clearLive2DTransform('a')).toEqual(DEFAULT_LIVE2D_TRANSFORM)
    expect(loadLive2DTransform('a')).toEqual(DEFAULT_LIVE2D_TRANSFORM)
  })

  it('clamps invalid or extreme transforms before applying them', () => {
    expect(normalizeLive2DTransform({ offsetX: 99, offsetY: Number.NaN, scale: 0 })).toEqual({
      offsetX: 1.5,
      offsetY: 0,
      scale: 0.25,
    })
  })
})
