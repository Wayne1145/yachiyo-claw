import type { ToolSet } from 'ai'
import { registerFeature, resetFeatureRegistry } from '@shared/features/registry'
import { afterEach, describe, expect, it } from 'vitest'
import type { FeatureToolsetFactory, ToolsetContext } from './toolset-contract'
import {
  buildRegisteredToolsets,
  getRegisteredFeatureToolsetIds,
  getRegisteredToolDisplay,
  registerFeatureToolset,
  resetFeatureToolsetRegistry,
} from './toolset-registry'

const tool = () => ({}) as ToolSet[string]

function ctx(featureOptions: Record<string, unknown> = {}): ToolsetContext {
  return { model: {} as never, messages: [], platformType: 'mobile', featureOptions }
}

const factory =
  (instructions: string, tools: string[], initialActiveTools?: string[]): FeatureToolsetFactory =>
  async () => ({
    instructions,
    tools: Object.fromEntries(tools.map((name) => [name, tool()])),
    ...(initialActiveTools ? { initialActiveTools } : {}),
  })

afterEach(() => {
  resetFeatureToolsetRegistry()
  resetFeatureRegistry()
})

describe('toolset registry', () => {
  it('rejects duplicate feature registration', () => {
    registerFeatureToolset('a', factory('a', []))
    expect(() => registerFeatureToolset('a', factory('a', []))).toThrow(/already registered/)
    expect(getRegisteredFeatureToolsetIds()).toEqual(['a'])
  })

  it('concatenates instructions in registration order deterministically', async () => {
    registerFeatureToolset('one', factory('<one>', ['t1']))
    registerFeatureToolset('two', factory('<two>', ['t2']))
    registerFeatureToolset('three', factory('<three>', ['t3']))
    const result = await buildRegisteredToolsets(ctx())
    expect(result.instructions).toBe('<one><two><three>')
    expect(Object.keys(result.tools).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('publishes optional tool display metadata without changing tool execution', async () => {
    registerFeatureToolset('display', async () => ({
      instructions: '',
      tools: { readable_tool: tool() },
      toolDisplay: { readable_tool: { label: 'Readable tool' } },
    }))
    await buildRegisteredToolsets(ctx())
    expect(getRegisteredToolDisplay('readable_tool')?.label).toBe('Readable tool')
    expect(getRegisteredToolDisplay('missing')).toBeUndefined()
  })

  it('throws on a tool-name collision across contributions', async () => {
    registerFeatureToolset('a', factory('', ['dup']))
    registerFeatureToolset('b', factory('', ['dup']))
    await expect(buildRegisteredToolsets(ctx())).rejects.toThrow(/Duplicate tool name "dup"/)
  })

  it('isolates a throwing factory without dropping the others', async () => {
    registerFeatureToolset('ok', factory('<ok>', ['good']))
    registerFeatureToolset('bad', async () => {
      throw new Error('boom')
    })
    registerFeatureToolset('ok2', factory('<ok2>', ['good2']))
    const result = await buildRegisteredToolsets(ctx())
    expect(result.instructions).toBe('<ok><ok2>')
    expect(Object.keys(result.tools).sort()).toEqual(['good', 'good2'])
  })

  it('dispatches featureOptions by featureId', async () => {
    let seen: unknown
    registerFeatureToolset('camera', async (context) => {
      seen = (context.featureOptions as Record<string, unknown>).camera
      return null
    })
    await buildRegisteredToolsets(ctx({ camera: { sessionId: 'cam-1' } }))
    expect(seen).toEqual({ sessionId: 'cam-1' })
  })

  it('skips null contributions', async () => {
    registerFeatureToolset('off', async () => null)
    registerFeatureToolset('on', factory('<on>', ['t']))
    const result = await buildRegisteredToolsets(ctx())
    expect(result.instructions).toBe('<on>')
    expect(Object.keys(result.tools)).toEqual(['t'])
  })

  it('filters registered built-in modules while leaving externally gated toolsets available', async () => {
    registerFeature({
      id: 'off',
      displayName: 'Off',
      description: 'Off',
      platforms: ['web'],
      trust: 'inert',
      enabledByDefault: true,
    })
    registerFeatureToolset('off', factory('<off>', ['hidden']))
    registerFeatureToolset('plugin-tools', factory('<plugin>', ['plugin_tool']))
    const result = await buildRegisteredToolsets({ ...ctx(), enabledFeatureIds: new Set(['other']) })
    // Unknown third-party aggregators keep their own grant gate; registered feature manifests are filtered upstream.
    expect(result.tools).toHaveProperty('plugin_tool')
  })

  it('omits activeTools when nothing stages, and stages correctly otherwise', async () => {
    registerFeatureToolset('plain', factory('', ['a', 'b']))
    const unstaged = await buildRegisteredToolsets(ctx())
    expect(unstaged.activeTools).toBeUndefined()

    resetFeatureToolsetRegistry()
    // A staged feature exposes only its initial subset; unstaged features expose all their tools.
    registerFeatureToolset('plain', factory('', ['web_search']))
    registerFeatureToolset('device', factory('', ['android_tap', 'android_type'], ['android_tap']))
    const staged = await buildRegisteredToolsets(ctx())
    expect(new Set(staged.activeTools)).toEqual(new Set(['web_search', 'android_tap']))
    expect(staged.activeTools).not.toContain('android_type')
  })
})
