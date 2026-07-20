import { describe, expect, it } from 'vitest'
import { ANDROID_MODEL_RESULT_MAX_BYTES, projectAgentResult, truncateUtf8 } from './agent-result-policy'

describe('agent result policy', () => {
  it('clips UTF-8 output without splitting the byte budget', () => {
    const result = truncateUtf8('中'.repeat(10_000))
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(ANDROID_MODEL_RESULT_MAX_BYTES)
  })

  it('projects nested tool output to a bounded summary', () => {
    const result = projectAgentResult({ stdout: 'x'.repeat(20_000), stderr: 'y'.repeat(20_000) })
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(ANDROID_MODEL_RESULT_MAX_BYTES)
  })
})

