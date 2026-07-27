import { describe, expect, it } from 'vitest'
import { fallbackSessionName, normalizeGeneratedSessionName } from './session-name'

describe('session name normalization', () => {
  it('uses a concise first user message when a local tool model emits protocol tokens', () => {
    const fallback = fallbackSessionName([
      {
        role: 'user',
        contentParts: [{ type: 'text', text: 'Use the echo tool to return PLUGIN_FINAL_OK and explain the result.' }],
      },
    ])
    expect(normalizeGeneratedSessionName('True <start_function_call> echo<escape>'.repeat(20), fallback)).toBe(
      'Use the echo tool to return PLUGIN_FINAL_OK and…'
    )
  })

  it('keeps a normal short model-generated title', () => {
    expect(normalizeGeneratedSessionName('"Android plugin smoke test"', 'Fallback')).toBe('Android plugin smoke test')
  })

  it('falls back for empty or excessively long generated titles', () => {
    expect(normalizeGeneratedSessionName('   ', 'First request')).toBe('First request')
    expect(normalizeGeneratedSessionName('x'.repeat(81), 'First request')).toBe('First request')
  })
})
