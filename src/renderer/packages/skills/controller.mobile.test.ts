import type { SkillHubAdapter } from '@shared/skills'
import type { MarketplaceSkill } from '@shared/types/skills'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getStoreValue: vi.fn(async (key: string) => values.get(key) ?? null),
    setStoreValue: vi.fn(async (key: string, value: unknown) => void values.set(key, value)),
  }
})

vi.mock('@/platform', () => ({
  default: { type: 'mobile', getStoreValue: state.getStoreValue, setStoreValue: state.setStoreValue },
}))

import { installMobileSkillHubSkill, skillsController } from './controller'

const skill: MarketplaceSkill = {
  id: 'reader',
  skillId: 'reader',
  slug: 'reader',
  name: 'Reader',
  installs: 1,
  source: 'https://skillhub.cn/skills/reader',
  revision: 'fixed-revision',
}

describe('mobile Skills controller', () => {
  beforeEach(() => {
    state.values.clear()
    vi.clearAllMocks()
  })

  it('stores SkillHub content as declarative-only metadata', async () => {
    const bytes = new TextEncoder().encode('---\nname: reader\ndescription: Reads docs\n---\nRead only.').buffer
    const adapter = {
      getSkill: vi.fn(async () => skill),
      download: vi.fn(async () => ({ slug: 'reader', revision: 'fixed-revision', bytes, contentType: 'text/markdown' })),
      verifyDownload: vi.fn(async () => ({ sha256: 'a'.repeat(64), signatureVerified: false })),
    } as unknown as SkillHubAdapter

    await expect(installMobileSkillHubSkill(skill, { adapter })).resolves.toEqual({ success: true, skillName: 'reader' })
    const stored = state.values.get('yachiyo-mobile-skills-v1') as Array<Record<string, unknown>>
    expect(stored[0]).toMatchObject({
      executionMode: 'declarative',
      source: { type: 'skillhub', revision: 'fixed-revision' },
      installRecord: { executionMode: 'declarative', signatureVerified: false },
    })
  })

  it('rejects privileged packages and never executes mobile scripts', async () => {
    await expect(installMobileSkillHubSkill({ ...skill, capabilityManifest: { privileged: true } })).resolves.toMatchObject({ success: false })
    await expect(skillsController.executeScript('reader', 'run.sh')).resolves.toMatchObject({ success: false, exitCode: 126 })
  })
})
