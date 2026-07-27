import { sha256Hex, type SkillHubAdapter } from '@shared/skills'
import type { MarketplaceSkill } from '@shared/types/skills'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  const tasks = new Map<string, Record<string, unknown>>()
  return {
    values,
    tasks,
    downloadBytes: new Uint8Array(),
    getStoreValue: vi.fn(async (key: string) => values.get(key) ?? null),
    setStoreValue: vi.fn(async (key: string, value: unknown) => void values.set(key, value)),
    executeMobileSkillScript: vi.fn(async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 })),
    enqueue: vi.fn(async (request: { id: string; kind: string; title: string; expectedSize: number }) => {
      tasks.set(request.id, {
        ...request,
        status: 'completed',
        bytesDownloaded: request.expectedSize,
        bytesTotal: request.expectedSize,
        bytesPerSecond: 0,
        updatedAt: Date.now(),
      })
      return { accepted: true, id: request.id }
    }),
    list: vi.fn(async () => ({ tasks: Array.from(tasks.values()) })),
    resume: vi.fn(async ({ id }: { id: string }) => ({ accepted: true, id })),
    probe: vi.fn(async () => ({ url: 'https://downloads.example/skill', size: state.downloadBytes.byteLength })),
    removeArtifact: vi.fn(async () => undefined),
    readCompletedDownload: vi.fn(async () => state.downloadBytes),
  }
})

vi.mock('@/platform', () => ({
  default: { type: 'mobile', getStoreValue: state.getStoreValue, setStoreValue: state.setStoreValue },
}))
vi.mock('@/mobile/mobile-skill-script', () => ({ executeMobileSkillScript: state.executeMobileSkillScript }))
vi.mock('@/platform/native/yachiyo_downloads', () => ({
  yachiyoDownloadsNative: {
    enqueue: state.enqueue,
    list: state.list,
    resume: state.resume,
    probe: state.probe,
    removeArtifact: state.removeArtifact,
  },
  readCompletedDownload: state.readCompletedDownload,
}))

import {
  installMobileSkillHubSkill,
  parseMarketplaceGitHubLocation,
  resumePendingMobileSkillInstalls,
  selectMarketplaceSkillPath,
  stableMobileSkillTaskId,
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
    state.tasks.clear()
    state.downloadBytes = new Uint8Array()
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

  it('derives stable download task ids from immutable source identity', async () => {
    const first = await stableMobileSkillTaskId('skillhub', 'reader\nfixed-revision')
    const repeated = await stableMobileSkillTaskId('skillhub', 'reader\nfixed-revision')
    const updated = await stableMobileSkillTaskId('skillhub', 'reader\nnext-revision')
    expect(repeated).toBe(first)
    expect(updated).not.toBe(first)
    expect(first).toMatch(/^skill-skillhub-[a-f0-9]{40}$/)
  })

  it('installs an owner/repo marketplace Skill on Android after discovering its real path', async () => {
    const content = '---\nname: find-skills\ndescription: Finds useful skills\n---\nSearch the ecosystem.'
    state.downloadBytes = new TextEncoder().encode(content)
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
        new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill',
        url: `https://raw.githubusercontent.com/vercel-labs/skills/${'a'.repeat(40)}/skills/find-skills/SKILL.md`,
      })
    )
    expect(state.probe).toHaveBeenCalledWith(
      expect.objectContaining({ maximumBytes: 32 * 1024 * 1024 })
    )
  })

  it('stores SkillHub content as declarative-only metadata', async () => {
    const bytes = new TextEncoder().encode('---\nname: reader\ndescription: Reads docs\n---\nRead only.').buffer
    state.downloadBytes = new Uint8Array(bytes)
    const adapter = {
      getSkill: vi.fn(async () => skill),
      resolveDownload: vi.fn(async () => ({
        slug: 'reader',
        revision: 'fixed-revision',
        url: 'https://downloads.skillhub.cn/reader.md',
        sizeBytes: bytes.byteLength,
        contentType: 'text/markdown',
      })),
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
    state.downloadBytes = new Uint8Array(bytes)
    const executableSkill: MarketplaceSkill = {
      ...skill,
      capabilityManifest: { scripts: true, privileged: true },
    }
    const adapter = {
      getSkill: vi.fn(async () => executableSkill),
      resolveDownload: vi.fn(async () => ({
        slug: 'reader',
        revision: 'fixed-revision',
        url: 'https://downloads.skillhub.cn/reader.zip',
        sizeBytes: bytes.byteLength,
        contentType: 'application/zip',
      })),
      verifyDownload: vi.fn(async () => ({ sha256: 'a'.repeat(64), signatureVerified: false })),
    } as unknown as SkillHubAdapter

    await expect(installMobileSkillHubSkill(executableSkill, { adapter })).resolves.toEqual({ success: true, skillName: 'reader' })
    await expect(skillsController.executeScript('reader', 'run')).resolves.toMatchObject({ success: false, exitCode: 126 })
    await expect(skillsController.configureScriptExecution('reader', true, [])).resolves.toMatchObject({ success: false })
    await expect(skillsController.configureScriptExecution('reader', true, ['unrestricted-privileged'])).resolves.toEqual({ success: true })
    await expect(skillsController.executeScript('reader', 'run', ['hello'])).resolves.toMatchObject({ success: true, stdout: 'ok' })
    expect(state.executeMobileSkillScript).toHaveBeenCalledWith(expect.objectContaining({ skillName: 'reader', args: ['hello'] }))
  })

  it('uses a stable task id and resumes a completed install after WebView restart without downloading again', async () => {
    const content = '---\nname: reader\ndescription: Reads docs\n---\nRecovered after restart.'
    state.downloadBytes = new TextEncoder().encode(content)
    const taskId = await stableMobileSkillTaskId('github', `owner/repo\n${'b'.repeat(40)}\nskills/reader`)
    state.values.set('yachiyo-mobile-skill-installs-v1', [
      {
        schemaVersion: 1,
        taskId,
        state: 'enqueued',
        sourceType: 'github',
        owner: 'owner',
        repo: 'repo',
        skillPath: 'skills/reader',
        revision: 'b'.repeat(40),
        descriptor: {
          url: `https://raw.githubusercontent.com/owner/repo/${'b'.repeat(40)}/skills/reader/SKILL.md`,
          sizeBytes: state.downloadBytes.byteLength,
          contentType: 'text/markdown',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    state.tasks.set(taskId, {
      id: taskId,
      kind: 'skill',
      title: 'Skill: reader',
      status: 'completed',
      bytesDownloaded: state.downloadBytes.byteLength,
      bytesTotal: state.downloadBytes.byteLength,
      bytesPerSecond: 0,
      updatedAt: Date.now(),
    })

    await resumePendingMobileSkillInstalls()

    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.removeArtifact).toHaveBeenCalledWith({ id: taskId, keepRecord: true })
    expect(state.values.get('yachiyo-mobile-skill-installs-v1')).toEqual([])
    expect(state.values.get('yachiyo-mobile-skills-v1')).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ name: 'reader' }) }),
    ])
  })

  it('recovers the prepared-to-enqueue crash window exactly once', async () => {
    const content = '---\nname: recovered\ndescription: Recovered install\n---\nReady.'
    state.downloadBytes = new TextEncoder().encode(content)
    const taskId = await stableMobileSkillTaskId('github', `owner/repo\n${'c'.repeat(40)}\nskills/recovered`)
    state.values.set('yachiyo-mobile-skill-installs-v1', [
      {
        schemaVersion: 1,
        taskId,
        state: 'prepared',
        sourceType: 'github',
        owner: 'owner',
        repo: 'repo',
        skillPath: 'skills/recovered',
        revision: 'c'.repeat(40),
        descriptor: {
          url: `https://raw.githubusercontent.com/owner/repo/${'c'.repeat(40)}/skills/recovered/SKILL.md`,
          sizeBytes: state.downloadBytes.byteLength,
          contentType: 'text/markdown',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    await resumePendingMobileSkillInstalls()

    expect(state.enqueue).toHaveBeenCalledOnce()
    expect(state.enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: taskId }))
    expect(state.values.get('yachiyo-mobile-skill-installs-v1')).toEqual([])
  })

  it('keeps completed bytes and install context when package consumption fails', async () => {
    const invalid = new TextEncoder().encode('---\nname: Invalid Name\ndescription: broken\n---\nbody')
    state.downloadBytes = invalid
    const adapter = {
      getSkill: vi.fn(async () => skill),
      resolveDownload: vi.fn(async () => ({
        slug: 'reader',
        revision: 'fixed-revision',
        url: 'https://downloads.skillhub.cn/broken.md',
        sizeBytes: invalid.byteLength,
        contentType: 'text/markdown',
      })),
      verifyDownload: vi.fn(async () => ({ sha256: 'a'.repeat(64), signatureVerified: false })),
    } as unknown as SkillHubAdapter

    await expect(installMobileSkillHubSkill(skill, { adapter })).resolves.toMatchObject({ success: false })
    expect(state.removeArtifact).not.toHaveBeenCalled()
    expect(state.values.get('yachiyo-mobile-skill-installs-v1')).toEqual([
      expect.objectContaining({ state: 'enqueued', lastError: 'Invalid SKILL.md' }),
    ])
  })
})
