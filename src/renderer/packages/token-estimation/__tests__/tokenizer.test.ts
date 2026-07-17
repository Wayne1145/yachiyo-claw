import { describe, expect, it } from 'vitest'
import {
  estimateDeepSeekTokens,
  estimateTokens,
  getTokenizerType,
  isDeepSeekModel,
  type TokenModel,
} from '../tokenizer'

const deepSeekModel: TokenModel = { provider: 'deepseek', modelId: 'deepseek-chat' }
const openAIModel: TokenModel = { provider: 'openai', modelId: 'gpt-4o' }
const claudeModel: TokenModel = { provider: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }

describe('isDeepSeekModel', () => {
  it('returns true for DeepSeek models', () => {
    expect(isDeepSeekModel(deepSeekModel)).toBe(true)
    expect(isDeepSeekModel({ provider: 'custom', modelId: 'deepseek-coder' })).toBe(true)
    expect(isDeepSeekModel({ provider: 'any', modelId: 'DEEPSEEK-V3' })).toBe(true)
  })

  it('returns false for non-DeepSeek models', () => {
    expect(isDeepSeekModel(openAIModel)).toBe(false)
    expect(isDeepSeekModel(claudeModel)).toBe(false)
    expect(isDeepSeekModel({ provider: 'mistral', modelId: 'mistral-large' })).toBe(false)
  })

  it('returns false for undefined or null', () => {
    expect(isDeepSeekModel(undefined)).toBe(false)
    expect(isDeepSeekModel(null)).toBe(false)
  })

  it('returns false for models with empty modelId', () => {
    expect(isDeepSeekModel({ provider: 'test', modelId: '' })).toBe(false)
  })
})

describe('getTokenizerType', () => {
  it('returns deepseek for DeepSeek models', () => {
    expect(getTokenizerType(deepSeekModel)).toBe('deepseek')
    expect(getTokenizerType({ provider: 'custom', modelId: 'deepseek-coder' })).toBe('deepseek')
  })

  it('returns default for non-DeepSeek models', () => {
    expect(getTokenizerType(openAIModel)).toBe('default')
    expect(getTokenizerType(claudeModel)).toBe('default')
    expect(getTokenizerType(undefined)).toBe('default')
    expect(getTokenizerType(null)).toBe('default')
  })
})

describe('estimateDeepSeekTokens', () => {
  it('estimates Chinese characters at ~0.6 tokens each', () => {
    const text = '你好世界'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBe(3)
  })

  it('estimates English characters at ~0.3 tokens each', () => {
    const text = 'Hello'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(5)
  })

  it('estimates special characters at ~0.3 tokens each', () => {
    const text = '!@#$%'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBe(2)
  })

  it('counts spaces as tokens', () => {
    const text = 'a b'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('collapses consecutive spaces into 1 token', () => {
    const textSingle = 'a b'
    const textMultiple = 'a   b'
    const tokensSingle = estimateDeepSeekTokens(textSingle)
    const tokensMultiple = estimateDeepSeekTokens(textMultiple)
    expect(tokensSingle).toBe(tokensMultiple)
  })

  it('handles mixed content', () => {
    const text = 'Hello 你好 123'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  it('returns minimum of 1 for empty string', () => {
    expect(estimateDeepSeekTokens('')).toBe(1)
  })

  it('handles newlines as whitespace', () => {
    const text = 'a\nb'
    const tokens = estimateDeepSeekTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('estimateTokens', () => {
  describe('default tokenizer (cl100k_base)', () => {
    it('estimates tokens for English text', () => {
      const text = 'Hello, world!'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(10)
    })

    it('estimates tokens for longer English text', () => {
      const text = 'The quick brown fox jumps over the lazy dog.'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(5)
      expect(tokens).toBeLessThan(20)
    })

    it('estimates tokens for Chinese text', () => {
      const text = '你好世界'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(20)
    })

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })

    it('handles special characters', () => {
      const text = '!@#$%^&*()_+-={}[]|:;<>?,./'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
    })

    it('handles unicode emojis', () => {
      const text = 'Hello! 😀🎉🚀'
      const tokens = estimateTokens(text)
      expect(tokens).toBeGreaterThan(0)
    })

    it('handles non-string input by converting to JSON', () => {
      const obj = { key: 'value', number: 123 }
      // @ts-expect-error - Testing runtime behavior with non-string input
      const tokens = estimateTokens(obj)
      expect(tokens).toBeGreaterThan(0)
    })
  })

  describe('DeepSeek tokenizer', () => {
    it('uses DeepSeek tokenizer for DeepSeek models', () => {
      const text = 'Hello, world!'
      const tokensDeepSeek = estimateTokens(text, deepSeekModel)
      expect(tokensDeepSeek).toBeGreaterThan(0)
    })

    it('handles Chinese text with DeepSeek tokenizer', () => {
      const text = '你好世界'
      const tokens = estimateTokens(text, deepSeekModel)
      expect(tokens).toBe(3)
    })

    it('returns minimum of 1 for empty input', () => {
      const tokens = estimateTokens('', deepSeekModel)
      expect(tokens).toBe(1)
    })
  })

  describe('tokenizer selection', () => {
    it('uses default tokenizer for OpenAI models', () => {
      const text = 'Hello'
      const tokensOpenAI = estimateTokens(text, openAIModel)
      const tokensDefault = estimateTokens(text)
      expect(tokensOpenAI).toBe(tokensDefault)
    })

    it('uses default tokenizer for Claude models', () => {
      const text = 'Hello'
      const tokensClaude = estimateTokens(text, claudeModel)
      const tokensDefault = estimateTokens(text)
      expect(tokensClaude).toBe(tokensDefault)
    })

    it('uses DeepSeek tokenizer for DeepSeek models', () => {
      const text = '你好世界'
      const tokensDeepSeek = estimateTokens(text, deepSeekModel)
      const tokensDefault = estimateTokens(text)
      expect(tokensDeepSeek).not.toBe(tokensDefault)
    })
  })
})
