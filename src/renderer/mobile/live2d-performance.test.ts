import { describe, expect, it } from 'vitest'
import { getLive2DResolution } from './live2d-performance'

describe('Live2D render quality', () => {
  it('caps the device pixel ratio for each quality profile', () => {
    expect(getLive2DResolution('performance', 3)).toBe(1)
    expect(getLive2DResolution('balanced', 3)).toBe(1.75)
    expect(getLive2DResolution('high', 3)).toBe(2.5)
    expect(getLive2DResolution('high', 1.5)).toBe(1.5)
  })
})
