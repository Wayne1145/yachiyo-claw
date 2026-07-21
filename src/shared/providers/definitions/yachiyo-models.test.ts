import { describe, expect, it } from 'vitest'
import { normalizeYachiyoModel, normalizeYachiyoModels } from './yachiyo-models'

describe('Yachiyo model capabilities', () => {
  it('marks GPT chat models as vision, tool-use and reasoning capable', () => {
    expect(
      normalizeYachiyoModels([
        { modelId: 'gpt-5.6', type: 'chat' },
        { modelId: 'gpt-5.6-mini', type: 'chat' },
        { modelId: 'gpt-4.1', type: 'chat' },
      ]).map((model) => model.capabilities)
    ).toEqual([
      ['vision', 'tool_use', 'reasoning'],
      ['vision', 'tool_use', 'reasoning'],
      ['vision', 'tool_use', 'reasoning'],
    ])
  })

  it('preserves explicit API capabilities while adding product-known GPT capabilities', () => {
    expect(normalizeYachiyoModel({ modelId: 'gpt-5.6-mini', capabilities: ['web_search', 'vision'] })).toMatchObject({
      capabilities: ['web_search', 'vision', 'tool_use', 'reasoning'],
    })
  })

  it('does not add chat capabilities to image, embedding or rerank models', () => {
    expect(normalizeYachiyoModel({ modelId: 'gpt-image-1', type: 'chat' }).capabilities).toBeUndefined()
    expect(normalizeYachiyoModel({ modelId: 'gpt-5.6', type: 'image' }).capabilities).toBeUndefined()
    expect(normalizeYachiyoModel({ modelId: 'text-embedding-3-large' }).capabilities).toBeUndefined()
    expect(normalizeYachiyoModel({ modelId: 'bge-reranker-v2' }).capabilities).toBeUndefined()
  })

  it('retains the existing Agent default for other chat model families', () => {
    expect(normalizeYachiyoModel({ modelId: 'claude-opus', type: 'chat' }).capabilities).toEqual(['tool_use'])
    expect(normalizeYachiyoModel({ modelId: 'claude-opus', capabilities: ['vision'] }).capabilities).toEqual(['vision'])
  })
})
