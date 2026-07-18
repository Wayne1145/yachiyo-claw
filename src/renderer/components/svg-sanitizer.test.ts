/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { sanitizeSvgMarkup } from './svg-sanitizer'

describe('SVG sanitizer', () => {
  it('removes scriptable SVG content while preserving shapes', () => {
    const sanitized = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="alert(1)" width="10"/><a href="javascript:alert(1)">x</a></svg>'
    )
    expect(sanitized).toContain('<rect')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onclick')
    expect(sanitized).not.toContain('javascript:')
  })
})
