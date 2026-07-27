import type { ModelInterface } from '@shared/models/types'
import { afterEach, describe, expect, it } from 'vitest'
import type { PromptContext } from './prompt-contract'
import { registerPromptBlock, renderPromptBlocks, resetPromptBlockRegistry } from './prompt-registry'

const context = (
  enabledFeatureIds?: ReadonlySet<string>,
  activeToolsetFeatureIds?: ReadonlySet<string>,
): PromptContext => ({
  model: {} as ModelInterface,
  messages: [],
  platformType: 'mobile',
  featureOptions: {},
  enabledFeatureIds,
  activeToolsetFeatureIds,
})

afterEach(resetPromptBlockRegistry)

describe('prompt block registry', () => {
  it('sorts blocks deterministically by order and feature id', () => {
    registerPromptBlock({ featureId: 'z', channel: 'agent-system', blockName: 'z', order: 20, render: () => 'z' })
    registerPromptBlock({ featureId: 'b', channel: 'agent-system', blockName: 'b', order: 10, render: () => 'b' })
    registerPromptBlock({ featureId: 'a', channel: 'agent-system', blockName: 'a', order: 10, render: () => 'a' })
    expect(renderPromptBlocks('agent-system', context())).toBe('a\n\nb\n\nz')
  })

  it('uses an explicit disabled block and keeps toolset prompts coupled to active tools', () => {
    registerPromptBlock({
      featureId: 'phone',
      channel: 'agent-system',
      blockName: 'phone',
      order: 1,
      render: () => 'enabled',
      renderDisabled: () => 'disabled',
    })
    registerPromptBlock({
      featureId: 'search',
      channel: 'toolset',
      blockName: 'search',
      order: 1,
      requiresActiveToolset: true,
      render: () => 'search',
    })
    expect(renderPromptBlocks('agent-system', context(new Set()))).toBe('disabled')
    expect(renderPromptBlocks('toolset', context(new Set(['search']), new Set()))).toBe('')
    expect(renderPromptBlocks('toolset', context(new Set(['search']), new Set(['search'])))).toBe('search')
  })
})
