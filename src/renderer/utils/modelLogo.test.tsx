import { describe, expect, it } from 'vitest'
import { getModelLogoConfig } from './modelLogo'

describe('model logo mapping', () => {
  it('maps Codex preview models to the OpenAI model icon', () => {
    expect(getModelLogoConfig('codex-auto-preview')).toBeDefined()
  })

  it('keeps unknown models on the provider fallback path', () => {
    expect(getModelLogoConfig('unknown-model-family')).toBeUndefined()
  })
})
