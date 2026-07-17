import { describe, expect, it } from 'vitest'
import { parseKnowledgeBaseModelString } from './knowledge-base-model-parser'

describe('parseKnowledgeBaseModelString', () => {
  it('parses valid provider:model format', () => {
    expect(parseKnowledgeBaseModelString('openai:gpt-4o')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
    })
  })

  it('parses model ids that contain additional colons', () => {
    expect(parseKnowledgeBaseModelString('openai:gpt-4:latest')).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4:latest',
    })
  })

  it('returns null for empty string', () => {
    expect(parseKnowledgeBaseModelString('')).toBeNull()
  })

  it('returns null for string without colon', () => {
    expect(parseKnowledgeBaseModelString('openai-gpt-4o')).toBeNull()
  })

  it('returns null when provider is empty', () => {
    expect(parseKnowledgeBaseModelString(':gpt-4o')).toBeNull()
  })

  it('returns null when model is empty', () => {
    expect(parseKnowledgeBaseModelString('openai:')).toBeNull()
  })
})
