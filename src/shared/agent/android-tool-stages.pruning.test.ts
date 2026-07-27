import { describe, expect, it } from 'vitest'
import { ANDROID_PRUNABLE_TOOL_RESULTS, ANDROID_TOOL_STAGE_FALLBACK } from './android-tool-stages'

describe('Android tool-result pruning declaration', () => {
  it('only names tools declared by the Android staged toolset', () => {
    const staged = new Set<string>(ANDROID_TOOL_STAGE_FALLBACK)
    expect(ANDROID_PRUNABLE_TOOL_RESULTS.length).toBeGreaterThan(0)
    for (const name of ANDROID_PRUNABLE_TOOL_RESULTS) expect(staged.has(name)).toBe(true)
  })
})
