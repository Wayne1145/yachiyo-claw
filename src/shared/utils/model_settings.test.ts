import { describe, it, expect } from 'vitest'
import { settings } from '../defaults'
import { getModelSettings } from './model_settings'
import { ModelProviderEnum } from '../types'

describe('getModelSettings', () => {
  it('throws when provider not found in settings.providers', () => {
    const globalSettings = {
      ...settings(),
      providers: {
        [ModelProviderEnum.OpenAI]: {},
      },
    }

    expect(() => getModelSettings(globalSettings, ModelProviderEnum.Claude, 'claude-3-5-sonnet')).toThrow(
      `provider ${ModelProviderEnum.Claude} not set`
    )
  })

  it('returns merged settings with provider and modelId when provider exists', () => {
    const globalSettings = {
      ...settings(),
      providers: {
        [ModelProviderEnum.OpenAI]: {
          apiKey: 'sk-test',
        },
      },
    }

    const result = getModelSettings(globalSettings, ModelProviderEnum.OpenAI, 'gpt-4o')

    expect(result).toMatchObject({
      ...globalSettings,
      provider: ModelProviderEnum.OpenAI,
      modelId: 'gpt-4o',
    })
  })

  it('handles undefined providers (settings.providers is undefined)', () => {
    const globalSettings = {
      ...settings(),
      providers: undefined,
    }

    expect(() => getModelSettings(globalSettings, ModelProviderEnum.OpenAI, 'gpt-4o')).toThrow(
      `provider ${ModelProviderEnum.OpenAI} not set`
    )
  })
})
