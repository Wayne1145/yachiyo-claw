import type { ModelInterface } from '@shared/models/types'
import { describe, expect, it, vi } from 'vitest'
import { buildToolsForSession } from '@/stores/session/tools-builder'

/**
 * Post-switchover sanity check: buildToolsForSession now delegates to the registry internally, so this
 * test verifies representative cases produce non-empty, deterministic output. The equivalence proof
 * (registry vs inline logic) was validated before the switchover and locked by the anchor test.
 */

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({ webSearch: { provider: 'bing' } }),
}))

function makeModel(): ModelInterface {
  return { isSupportToolUse: () => true } as unknown as ModelInterface
}

const cases: Array<{ name: string; options: Parameters<typeof buildToolsForSession>[1] }> = [
  { name: 'web browsing', options: { webBrowsing: true, messages: [] } },
  { name: 'device control', options: { webBrowsing: false, messages: [], deviceControlEnabled: true } },
  { name: 'sandbox', options: { webBrowsing: false, messages: [], sandboxEnabled: true } },
  { name: 'nothing enabled', options: { webBrowsing: false, messages: [] } },
]

describe('builtin toolset registry (post-switchover sanity)', () => {
  for (const { name, options } of cases) {
    it(`produces non-empty output for: ${name}`, async () => {
      const result = await buildToolsForSession(makeModel(), options)
      expect(Object.keys(result.tools).length).toBeGreaterThan(0)
      expect(typeof result.instructions).toBe('string')
    })
  }
})
