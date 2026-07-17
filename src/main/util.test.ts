import { describe, expect, it } from 'vitest'

import { sliceTextWithEllipsis } from './util'

describe('sliceTextWithEllipsis', () => {
  it('returns original text if length <= maxLength', () => {
    const text = 'short text'
    expect(sliceTextWithEllipsis(text, text.length)).toBe(text)
  })

  it('slices long text without adding ellipsis marker', () => {
    const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const result = sliceTextWithEllipsis(text, 20)

    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(text.length)
    expect(result).not.toContain('...')
  })

  it('contains beginning and end of original text', () => {
    const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const result = sliceTextWithEllipsis(text, 20)

    expect(result.startsWith(text.slice(0, 1))).toBe(true)
    expect(result.endsWith(text.slice(-1))).toBe(true)
  })
})
