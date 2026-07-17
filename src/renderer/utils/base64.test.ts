import { describe, expect, it } from 'vitest'

import { decodeBase64 } from './base64'

describe('decodeBase64', () => {
  it('decodes a normal base64 string', () => {
    expect(decodeBase64('SGVsbG8sIHdvcmxkIQ==')).toBe('Hello, world!')
  })

  it('replaces spaces with + before decoding', () => {
    expect(decodeBase64('8J Ygg==')).toBe('😂')
  })

  it('handles empty string', () => {
    expect(decodeBase64('')).toBe('')
  })
})
