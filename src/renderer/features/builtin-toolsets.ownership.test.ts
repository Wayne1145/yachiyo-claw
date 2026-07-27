import type { ModelInterface } from '@shared/models/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { registerBuiltinFeatures } from './builtin-features'
import { registerBuiltinToolsets } from './builtin-toolsets'
import { buildRegisteredToolsets } from './toolset-registry'

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({ webSearch: { provider: 'bing' } }),
}))

const model = { isSupportToolUse: () => true } as unknown as ModelInterface

beforeAll(() => {
  registerBuiltinFeatures()
  registerBuiltinToolsets()
})

function context(enabledFeatureIds: ReadonlySet<string>) {
  return {
    model,
    messages: [],
    platformType: 'mobile',
    agentRunId: 'run-1',
    approvalSessionId: 'session-1',
    enabledFeatureIds,
    featureOptions: {
      sandbox: { sandboxEnabled: true },
      workspace: { sandboxEnabled: true },
      skills: { sandboxEnabled: true, enabledSkillNames: [] },
    },
  }
}

describe('built-in tool ownership', () => {
  it('registers structured workspace and Skill authoring tools on Android', async () => {
    const result = await buildRegisteredToolsets(context(new Set(['sandbox', 'workspace', 'skills'])))
    expect(result.tools).toHaveProperty('sandbox_bash')
    expect(result.tools).toHaveProperty('workspace_plan')
    expect(result.tools).toHaveProperty('workspace_apply_patch')
    expect(result.tools).toHaveProperty('workspace_preview')
    expect(result.tools).toHaveProperty('write_skill')
  })

  it('removes workspace and Skill tools without removing the Linux shell', async () => {
    const result = await buildRegisteredToolsets(context(new Set(['sandbox'])))
    expect(result.tools).toHaveProperty('sandbox_bash')
    expect(result.tools).not.toHaveProperty('workspace_plan')
    expect(result.tools).not.toHaveProperty('workspace_preview')
    expect(result.tools).not.toHaveProperty('write_skill')
  })
})
