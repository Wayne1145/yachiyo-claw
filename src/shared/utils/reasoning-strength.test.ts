import { describe, expect, it } from 'vitest'
import { ModelProviderEnum } from '../types'
import { getSessionReasoningStrength, mapReasoningStrength, resolveReasoningProviderOptions } from './reasoning-strength'

describe('reasoning strength', () => {
  it('maps OpenAI MAX to xhigh and Off to none', () => {
    expect(mapReasoningStrength('max', ModelProviderEnum.Yachiyo, 'gpt-5.6').providerOptions).toEqual({
      openai: { reasoningEffort: 'xhigh' },
    })
    expect(mapReasoningStrength('off', ModelProviderEnum.OpenAIResponses, 'gpt-5.4').providerOptions).toEqual({
      openai: { reasoningEffort: 'none' },
    })
  })

  it('maps Gemini budgets and reports fixed-level limitations honestly', () => {
    expect(mapReasoningStrength('medium', ModelProviderEnum.Gemini, 'gemini-2.5-flash').providerOptions).toEqual({
      google: { thinkingConfig: { thinkingBudget: 5120, includeThoughts: true } },
    })
    expect(mapReasoningStrength('off', ModelProviderEnum.Gemini, 'gemini-3-pro').exact).toBe(false)
  })

  it('uses OpenRouter reasoning options instead of OpenAI fields', () => {
    expect(mapReasoningStrength('high', ModelProviderEnum.OpenRouter, 'openai/gpt-5.4').providerOptions).toEqual({
      openrouter: { reasoning: { enabled: true, effort: 'high' } },
    })
  })

  it('reads legacy provider settings and lets normalized settings override them', () => {
    expect(
      getSessionReasoningStrength({ providerOptions: { openai: { reasoningEffort: 'high' } } }),
    ).toBe('high')
    expect(
      resolveReasoningProviderOptions({
        provider: ModelProviderEnum.OpenAI,
        modelId: 'gpt-5.4',
        reasoningStrength: 'minimal',
        providerOptions: { openai: { reasoningEffort: 'high' } },
      })?.openai?.reasoningEffort,
    ).toBe('minimal')
  })
})
