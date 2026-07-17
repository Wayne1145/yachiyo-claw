import { describe, expect, it } from 'vitest'
import { countWord } from './word_count'

describe('countWord', () => {
  it('counts English words', () => {
    expect(countWord('hello world')).toBe(2)
    expect(countWord('one two three four')).toBe(4)
  })

  it('counts single word', () => {
    expect(countWord('hello')).toBe(1)
  })

  it('counts Chinese characters individually', () => {
    expect(countWord('你好世界')).toBe(4)
    expect(countWord('测试')).toBe(2)
  })

  it('counts mixed Chinese and English', () => {
    expect(countWord('hello 你好 world')).toBe(4) // 2 English words + 2 Chinese chars
  })

  it('returns 0 for empty string', () => {
    expect(countWord('')).toBe(0)
  })

  it('returns 0 for whitespace only', () => {
    expect(countWord('   ')).toBe(0)
  })

  it('counts words with numbers', () => {
    expect(countWord('test123 hello')).toBe(2)
  })

  it('handles Japanese hiragana as single word block', () => {
    // Hiragana (U+3040-309F) is matched as CJK block but charCode < 0x4E00,
    // so the whole block counts as 1 word (same as English word counting)
    expect(countWord('こんにちは')).toBe(1)
  })

  it('counts CJK ideographs per character', () => {
    // Kanji (U+4E00+) chars: charCodeAt(0) >= 0x4E00, so count += length
    expect(countWord('漢字')).toBe(2)
  })

  it('handles punctuation-only strings', () => {
    expect(countWord('...')).toBe(0)
    expect(countWord('!@#$%')).toBe(0)
  })

  it('counts words separated by various whitespace', () => {
    expect(countWord('hello\tworld\nfoo')).toBe(3)
  })
})
