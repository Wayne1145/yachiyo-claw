import { describe, expect, it } from 'vitest'
import { parseImage } from './base64'

describe('parseImage', () => {
  it('should parse base64 image data correctly', () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAChA...'
    const result = parseImage(base64)
    expect(result).toEqual({ type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAChA...' })
  })

  it('should handle base64 data without a type correctly', () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAChA...'
    const result = parseImage(base64)
    expect(result).toEqual({ type: '', data: '' })
  })

  it('should handle empty base64 data correctly', () => {
    const base64 = ''
    const result = parseImage(base64)
    expect(result).toEqual({ type: '', data: '' })
  })
})
