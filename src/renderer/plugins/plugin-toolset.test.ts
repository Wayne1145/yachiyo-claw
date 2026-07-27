import type { ToolExecutionOptions } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePluginManifest } from '@shared/plugins/manifest'
import { ANDROID_TOOL_STAGE_INITIAL } from '@shared/agent/android-tool-stages'
import type { ToolsetContext } from '@/features/toolset-contract'
import {
  buildRegisteredToolsets,
  registerFeatureToolset,
  resetFeatureToolsetRegistry,
} from '@/features/toolset-registry'
import type { InstalledPluginRecord } from './installer'
import {
  buildPluginToolset,
  PLUGIN_TOOL_LIMITS,
  pluginToolRejections,
  type PluginToolsetSources,
} from './plugin-toolset'

const approvals: { risk: string; approve: boolean }[] = []
vi.mock('@/mobile/agent-approval', () => ({
  requestAgentApproval: vi.fn(async (input: { risk: string }) => {
    approvals.push({ risk: input.risk, approve: true })
    return true
  }),
}))

function record(over: Partial<{ id: string; tools: unknown[]; entrySha: string }> = {}): InstalledPluginRecord {
  const id = over.id ?? 'demo'
  return {
    manifest: parsePluginManifest({
      schemaVersion: 1,
      id,
      version: '1.0.0',
      displayName: `Plugin ${id}`,
      description: 'A tool-contributing plugin used in tests.',
      entry: 'main.js',
      entrySha256: 'a'.repeat(64),
      capabilities: [{ name: 'tools', reason: 'Contributes tools to the agent for testing.' }],
      contributions: {
        tools: over.tools ?? [{ name: `${id}_echo`, description: 'Echo tool.', riskLevel: 'read' }],
      },
      files: [{ path: 'main.js', size: 1, sha256: 'a'.repeat(64) }],
    }),
    packageSha256: 'b'.repeat(64),
    signatureVerified: false,
    deviceGrantAllowed: false,
    source: 'sideload',
    installedAt: 0,
  }
}

function makeSources(
  over: Partial<PluginToolsetSources> & { records?: InstalledPluginRecord[]; granted?: boolean } = {},
) {
  const audits: { toolName: string; status: string }[] = []
  const terminated: string[] = []
  const sources: PluginToolsetSources = {
    listPlugins: async () => over.records ?? [record()],
    grants: over.grants ?? { isToolsGranted: async () => over.granted ?? true },
    runtime:
      over.runtime ??
      ({
        invoke: async (_pluginId, _toolName, args) => ({ echoed: args }),
        terminate: (pluginId) => terminated.push(pluginId),
      } as PluginToolsetSources['runtime']),
    audit: over.audit ?? { record: (entry) => audits.push({ toolName: entry.toolName, status: entry.status }) },
  }
  return { sources, audits, terminated }
}

const context: ToolsetContext = { model: {} as never, messages: [], platformType: 'mobile', featureOptions: {} }

const run = async (sources: PluginToolsetSources, name: string, args: unknown = {}) => {
  const contribution = await buildPluginToolset(sources)(context)
  const toolImpl = contribution?.tools[name]
  if (!toolImpl?.execute) throw new Error(`tool ${name} not registered`)
  return toolImpl.execute(args as never, {} as ToolExecutionOptions)
}

afterEach(() => {
  approvals.length = 0
  resetFeatureToolsetRegistry()
})

describe('buildPluginToolset registration gates', () => {
  it('skips tools when the tools capability is not granted, with a visible reason', async () => {
    const { sources } = makeSources({ granted: false })
    expect(await buildPluginToolset(sources)(context)).toBeNull()
    expect(pluginToolRejections).toContainEqual({
      pluginId: 'demo',
      toolName: 'demo_echo',
      reason: 'tools_capability_not_granted',
    })
  })

  it('rejects an unprefixed tool name (defense in depth behind the manifest gate)', async () => {
    // parsePluginManifest already rejects this, so construct the record bypassing it.
    const bad = record()
    ;(bad.manifest.contributions.tools as { name: string }[])[0].name = 'other_echo'
    const { sources } = makeSources({ records: [bad] })
    expect(await buildPluginToolset(sources)(context)).toBeNull()
    expect(pluginToolRejections[0]?.reason).toBe('name_not_prefixed')
  })

  it('rejects the later plugin on a name collision, keeping the first', async () => {
    const first = record({ id: 'alpha', tools: [{ name: 'alpha_do', description: 'First.', riskLevel: 'read' }] })
    const second = record({ id: 'beta', tools: [{ name: 'beta_do', description: 'Second.', riskLevel: 'read' }] })
    ;(second.manifest.contributions.tools as { name: string }[])[0].name = 'alpha_do'
    // Bypassed prefix for collision simulation — restore prefix legitimacy via id match.
    Object.defineProperty(second.manifest, 'id', { value: 'alpha' })
    const { sources } = makeSources({ records: [first, second] })
    const contribution = await buildPluginToolset(sources)(context)
    expect(Object.keys(contribution?.tools ?? {})).toEqual(['alpha_do'])
    expect(pluginToolRejections.some((r) => r.reason === 'name_collision')).toBe(true)
  })

  it('rejects an unsupported schema for one tool without affecting the others', async () => {
    const mixed = record({
      id: 'demo',
      tools: [
        {
          name: 'demo_bad',
          description: 'Uses $ref.',
          parameters: { type: 'object', properties: { a: { $ref: '#/x' } } },
          riskLevel: 'read',
        },
        { name: 'demo_good', description: 'Fine.', riskLevel: 'read' },
      ],
    })
    const { sources } = makeSources({ records: [mixed] })
    const contribution = await buildPluginToolset(sources)(context)
    expect(Object.keys(contribution?.tools ?? {})).toEqual(['demo_good'])
    expect(pluginToolRejections[0]?.reason).toMatch(/unsupported_schema/)
  })

  it('enforces the total tool cap with visible reasons', async () => {
    const records = Array.from({ length: 5 }, (_, index) =>
      record({
        id: `p${index}`,
        tools: Array.from({ length: 8 }, (_, t) => ({
          name: `p${index}_t${t}`,
          description: `Tool ${t}.`,
          riskLevel: 'read',
        })),
      }),
    )
    const { sources } = makeSources({ records })
    const contribution = await buildPluginToolset(sources)(context)
    expect(Object.keys(contribution?.tools ?? {})).toHaveLength(PLUGIN_TOOL_LIMITS.maxToolsTotal)
    expect(pluginToolRejections.filter((r) => r.reason === 'total_tool_limit').length).toBeGreaterThan(0)
  })

  it('manifest rejects riskLevel above act', () => {
    expect(() =>
      parsePluginManifest({
        schemaVersion: 1,
        id: 'evil',
        version: '1.0.0',
        displayName: 'Evil',
        description: 'Tries to declare a destructive tool.',
        entry: 'main.js',
        entrySha256: 'a'.repeat(64),
        capabilities: [{ name: 'tools', reason: 'Wants dangerous powers for testing.' }],
        contributions: { tools: [{ name: 'evil_wipe', description: 'Wipe.', riskLevel: 'destructive' }] },
        files: [{ path: 'main.js', size: 1, sha256: 'a'.repeat(64) }],
      }),
    ).toThrow()
  })
})

describe('buildPluginToolset execution policy', () => {
  it('maps read → safe and act → dangerous approvals', async () => {
    const twoLevels = record({
      tools: [
        { name: 'demo_read', description: 'Read-only.', riskLevel: 'read' },
        { name: 'demo_act', description: 'Acts.', riskLevel: 'act' },
      ],
    })
    const { sources } = makeSources({ records: [twoLevels] })
    await run(sources, 'demo_read')
    await run(sources, 'demo_act')
    expect(approvals.map((a) => a.risk)).toEqual(['safe', 'dangerous'])
  })

  it('clamps oversized results through projectAgentResult', async () => {
    const { sources } = makeSources({
      runtime: { invoke: async () => 'x'.repeat(100_000), terminate: () => {} },
    })
    const result = (await run(sources, 'demo_echo')) as string
    expect(result.length).toBeLessThan(100_000)
  })

  it('terminates the isolate and returns a timeout error on timeout', async () => {
    const { sources, terminated, audits } = makeSources({
      runtime: {
        invoke: async () => {
          throw new Error('timeout')
        },
        terminate: (pluginId) => terminated.push(pluginId),
      },
    })
    expect(await run(sources, 'demo_echo')).toEqual({ error: 'plugin_tool_timeout' })
    expect(terminated).toEqual(['demo'])
    expect(audits.at(-1)).toEqual({ toolName: 'demo_echo', status: 'timeout' })
  })

  it('fails closed when the grant is revoked mid-session', async () => {
    let granted = true
    const { sources, audits } = makeSources({ grants: { isToolsGranted: async () => granted } })
    const contribution = await buildPluginToolset(sources)(context)
    const impl = contribution?.tools.demo_echo
    granted = false // Revoked after the session's tool list was built.
    expect(await impl?.execute?.({} as never, {} as ToolExecutionOptions)).toEqual({
      error: 'plugin_tools_capability_revoked',
    })
    expect(audits.at(-1)).toEqual({ toolName: 'demo_echo', status: 'denied' })
    // And a NEW session build excludes the tool entirely.
    expect(await buildPluginToolset(sources)(context)).toBeNull()
  })

  it('keeps plugin tools model-visible when android staging is active (staging regression)', async () => {
    const { sources } = makeSources()
    registerFeatureToolset('android-device', async () => ({
      instructions: '',
      tools: { android_tap: {} as never, android_type: {} as never },
      initialActiveTools: ANDROID_TOOL_STAGE_INITIAL,
    }))
    registerFeatureToolset('plugin-tools', buildPluginToolset(sources))
    const result = await buildRegisteredToolsets(context)
    expect(result.activeTools).toContain('demo_echo')
  })
})
