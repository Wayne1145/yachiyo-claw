import type { ProviderOptions, ReasoningStrength, SessionSettings } from '../types'
import { ModelProviderEnum } from '../types'
import { getGoogleThinkingMode, getSupportedGoogleThinkingLevels } from './google-thinking'

export const REASONING_STRENGTHS: ReasoningStrength[] = ['off', 'minimal', 'low', 'medium', 'high', 'max']

export type ReasoningMapping = {
  providerOptions?: ProviderOptions
  effectiveLabel: string
  exact: boolean
}

const CLAUDE_BUDGET: Record<Exclude<ReasoningStrength, 'off'>, number> = {
  minimal: 1024,
  low: 2048,
  medium: 5120,
  high: 10000,
  max: 32000,
}

const GOOGLE_BUDGET: Record<Exclude<ReasoningStrength, 'off'>, number> = {
  minimal: 1024,
  low: 2048,
  medium: 5120,
  high: 10000,
  max: 24576,
}

export function getSessionReasoningStrength(settings?: SessionSettings): ReasoningStrength | undefined {
  if (settings?.reasoningStrength) return settings.reasoningStrength

  const openaiEffort = settings?.providerOptions?.openai?.reasoningEffort
  if (openaiEffort === 'none') return 'off'
  if (openaiEffort === 'xhigh') return 'max'
  if (openaiEffort) return openaiEffort

  const claudeThinking = settings?.providerOptions?.claude?.thinking
  if (claudeThinking?.type === 'disabled') return 'off'
  if (claudeThinking?.type === 'enabled') {
    const budget = claudeThinking.budgetTokens
    if (budget >= 32000) return 'max'
    if (budget >= 10000) return 'high'
    if (budget >= 5120) return 'medium'
    if (budget >= 2048) return 'low'
    return 'minimal'
  }

  const googleThinking = settings?.providerOptions?.google?.thinkingConfig
  if (googleThinking?.thinkingLevel) return googleThinking.thinkingLevel
  if (googleThinking?.thinkingBudget === 0) return 'off'
  if (googleThinking?.thinkingBudget !== undefined) {
    if (googleThinking.thinkingBudget >= 24576) return 'max'
    if (googleThinking.thinkingBudget >= 10000) return 'high'
    if (googleThinking.thinkingBudget >= 5120) return 'medium'
    if (googleThinking.thinkingBudget >= 2048) return 'low'
    return 'minimal'
  }
  return undefined
}

function mapGoogle(strength: ReasoningStrength, modelId: string): ReasoningMapping {
  const mode = getGoogleThinkingMode(modelId)
  if (mode === 'budget') {
    return {
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: strength === 'off' ? 0 : GOOGLE_BUDGET[strength],
            includeThoughts: strength !== 'off',
          },
        },
      },
      effectiveLabel: strength,
      exact: true,
    }
  }

  if (mode === 'level') {
    const supported = getSupportedGoogleThinkingLevels(modelId)
    const requested = strength === 'off' || strength === 'minimal' ? 'minimal' : strength === 'max' ? 'high' : strength
    const effective = supported.includes(requested) ? requested : supported[0]
    if (!effective) return { effectiveLabel: 'model default', exact: false }
    return {
      providerOptions: { google: { thinkingConfig: { thinkingLevel: effective, includeThoughts: true } } },
      effectiveLabel: effective,
      exact: effective === strength,
    }
  }

  return { effectiveLabel: 'model fixed', exact: false }
}

export function mapReasoningStrength(
  strength: ReasoningStrength | undefined,
  provider: string | undefined,
  modelId: string | undefined,
): ReasoningMapping {
  if (!strength) return { effectiveLabel: 'model default', exact: true }

  if (provider === ModelProviderEnum.Gemini) return mapGoogle(strength, modelId || '')

  if (provider === ModelProviderEnum.Claude) {
    return {
      providerOptions: {
        claude: {
          thinking:
            strength === 'off'
              ? { type: 'disabled', budgetTokens: 0 }
              : { type: 'enabled', budgetTokens: CLAUDE_BUDGET[strength] },
        },
      },
      effectiveLabel: strength,
      exact: true,
    }
  }

  if (provider === ModelProviderEnum.OpenRouter) {
    const effort = strength === 'off' ? undefined : strength === 'max' || strength === 'high' ? 'high' : strength === 'medium' ? 'medium' : 'low'
    return {
      providerOptions: {
        openrouter: {
          reasoning: strength === 'off' ? { enabled: false, max_tokens: 0 } : { enabled: true, effort },
        },
      },
      effectiveLabel: strength === 'max' ? 'high' : strength,
      exact: strength !== 'max',
    }
  }

  if (
    provider === ModelProviderEnum.OpenAI ||
    provider === ModelProviderEnum.OpenAIResponses ||
    provider === ModelProviderEnum.Yachiyo
  ) {
    const reasoningEffort = strength === 'off' ? 'none' : strength === 'max' ? 'xhigh' : strength
    return {
      providerOptions: { openai: { reasoningEffort } },
      effectiveLabel: reasoningEffort,
      exact: true,
    }
  }

  return { effectiveLabel: 'model fixed', exact: false }
}

export function resolveReasoningProviderOptions(settings?: SessionSettings): ProviderOptions | undefined {
  const mapped = mapReasoningStrength(
    getSessionReasoningStrength(settings),
    settings?.provider,
    settings?.modelId,
  ).providerOptions
  if (!mapped) return settings?.providerOptions

  return {
    ...settings?.providerOptions,
    ...mapped,
    openai: mapped.openai ? { ...settings?.providerOptions?.openai, ...mapped.openai } : settings?.providerOptions?.openai,
    claude: mapped.claude ? { ...settings?.providerOptions?.claude, ...mapped.claude } : settings?.providerOptions?.claude,
    google: mapped.google ? { ...settings?.providerOptions?.google, ...mapped.google } : settings?.providerOptions?.google,
    openrouter: mapped.openrouter
      ? { ...settings?.providerOptions?.openrouter, ...mapped.openrouter }
      : settings?.providerOptions?.openrouter,
  }
}
