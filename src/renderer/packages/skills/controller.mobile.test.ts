import { sha256Hex, type SkillHubAdapter } from '@shared/skills'
import type { MarketplaceSkill } from '@shared/types/skills'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  return {
    values,
    getStoreValue: vi.fn(async (key: string) => values.get(key) ?? null),
    setStoreValue: vi.fn(async (key: string, value: unknown) => void values.set(key, value)),
    executeMobileSkillScript: vi.fn(async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 })),
  }
})

vi.mock('@/platform', () => ({
  default: { type: 'mobile', getStoreValue: state.getStoreValue, setStoreValue: state.setStoreValue },
}))
vi.mock('@/mobile/mobile-skill-script', () => ({ executeMobileSkillScript: state.executeMobileSkillScript }))

import {
  installMobileSkillHubSkill,
  parseMarketplaceGitHubLocation,
  selectMarketplaceSkillPath,
  skillsController,
} from './controller'

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

  it('resolves skills.sh and owner/repo marketplace sources to GitHub Skill directories', () => {
    const marketplace = {
      ...skill,
      id: 'vercel-labs/skills/find-skills',
      skillId: 'find-skills',
      slug: undefined,
      source: 'vercel-labs/skills',
    }
    const location = parseMarketplaceGitHubLocation(marketplace.source)
    expect(location).toEqual({ owner: 'vercel-labs', repo: 'skills', suggestedPath: '' })
    expect(
      selectMarketplaceSkillPath(marketplace, location!, [
        { path: 'skills/another-skill' },
        { path: 'skills/find-skills' },
      ])
    ).toBe('skills/find-skills')
    expect(parseMarketplaceGitHubLocation('https://skills.sh/owner/repo/path/to/skill')).toEqual({
      owner: 'owner',
      repo: 'repo',
      suggestedPath: 'path/to/skill',
    })
  })

  it('installs an owner/repo marketplace Skill on Android after discovering its real path', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tree: [
              { path: 'skills/another/SKILL.md', type: 'blob' },
              { path: 'skills/find-skills/SKILL.md', type: 'blob' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response('---\nname: find-skills\ndescription: Finds useful skills\n---\nSearch the ecosystem.', {
          status: 200,
        })
      )
    vi.stubGlobal('fetch', request)
    const marketplace: MarketplaceSkill = {
      id: 'vercel-labs/skills/find-skills',
      skillId: 'find-skills',
      name: 'Find Skills',
      installs: 100,
      source: 'vercel-labs/skills',
    }

    await expect(skillsController.installMarketplaceSkill(marketplace)).resolves.toEqual({
      success: true,
      skillName: 'find-skills',
    })
    expect(request).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/vercel-labs/skills/HEAD/skills/find-skills/SKILL.md'
    )
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

  it('validates executable packages and keeps scripts disabled until capabilities are granted', async () => {
    const scriptContent = 'echo "$1"\n'
    const scriptBytes = new TextEncoder().encode(scriptContent)
    const scriptHash = await sha256Hex(scriptBytes)
    const manifest = {
      schemaVersion: 1,
      entrypoints: [
        {
          name: 'run',
          path: 'scripts/run.sh',
          runtime: 'shell',
          sha256: scriptHash,
          size: scriptBytes.byteLength,
          timeoutMs: 5_000,
          workingDirectory: 'skill-private',
          isolation: 'none',
          capabilities: ['unrestricted-privileged'],
        },
      ],
    }
    const zip = new JSZip()
    zip.file('SKILL.md', '---\nname: reader\ndescription: Reads docs\n---\nRun the declared script.')
    zip.file('yachiyo-skill.json', JSON.stringify(manifest))
    zip.file('scripts/run.sh', scriptContent)
    const bytes = await zip.generateAsync({ type: 'arraybuffer' })
    const executableSkill: MarketplaceSkill = {
      ...skill,
      capabilityManifest: { scripts: true, privileged: true },
    }
    const adapter = {
      getSkill: vi.fn(async () => executableSkill),
      download: vi.fn(async () => ({ slug: 'reader', revision: 'fixed-revision', bytes, contentType: 'application/zip' })),
      verifyDownload: vi.fn(async () => ({ sha256: 'a'.repeat(64), signatureVerified: false })),
    } as unknown as SkillHubAdapter

    await expect(installMobileSkillHubSkill(executableSkill, { adapter })).resolves.toEqual({ success: true, skillName: 'reader' })
    await expect(skillsController.executeScript('reader', 'run')).resolves.toMatchObject({ success: false, exitCode: 126 })
    await expect(skillsController.configureScriptExecution('reader', true, [])).resolves.toMatchObject({ success: false })
    await expect(skillsController.configureScriptExecution('reader', true, ['unrestricted-privileged'])).resolves.toEqual({ success: true })
    await expect(skillsController.executeScript('reader', 'run', ['hello'])).resolves.toMatchObject({ success: true, stdout: 'ok' })
    expect(state.executeMobileSkillScript).toHaveBeenCalledWith(expect.objectContaining({ skillName: 'reader', args: ['hello'] }))
  })
})
