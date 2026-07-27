import { describe, expect, it } from 'vitest'
import { replaceSessionPromptBlock } from './session-prompt-block'

describe('replaceSessionPromptBlock', () => {
  it('is idempotent and removes stale content', () => {
    const once = replaceSessionPromptBlock('Soul', 'live2d', 'smile')
    expect(replaceSessionPromptBlock(once, 'live2d', 'smile')).toBe(once)
    expect(replaceSessionPromptBlock(once, 'live2d', null)).toBe('Soul')
  })

  it('escapes regular-expression characters in block names', () => {
    const once = replaceSessionPromptBlock('Soul', 'feature[1].prompt', 'one')
    const twice = replaceSessionPromptBlock(once, 'feature[1].prompt', 'two')
    expect(twice).not.toContain('one')
    expect(twice.match(/feature\[1\]\.prompt:start/g)).toHaveLength(1)
  })
})
