import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}))

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}))

vi.mock('../util', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('./github-fetcher', () => ({
  detectSkillsInRepo: vi.fn(),
  downloadSkillFiles: vi.fn(),
  getLatestCommitHash: vi.fn(),
}))

vi.mock('./parser', () => ({
  parseSkillFile: vi.fn(),
}))

import fs from 'fs'
import { detectSkillsInRepo, downloadSkillFiles, getLatestCommitHash } from './github-fetcher'
import { checkForUpdates, deleteSkill, installSkillFromGitHub, installSkillFromMarketplace } from './installer'
import { parseSkillFile } from './parser'

const mockedFs = vi.mocked(fs)
const mockedDetect = vi.mocked(detectSkillsInRepo)
const mockedDownload = vi.mocked(downloadSkillFiles)
const mockedGetHash = vi.mocked(getLatestCommitHash)
const mockedParse = vi.mocked(parseSkillFile)

describe('installer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('installSkillFromGitHub', () => {
    it('should install skill successfully', async () => {
      mockedDownload.mockResolvedValue(undefined)
      mockedFs.existsSync.mockImplementation((p) => {
        if (String(p).includes('SKILL.md')) return true
        if (String(p).includes('.tmp-')) return false
        return false
      })
      mockedParse.mockReturnValue({
        metadata: { name: 'my-new-skill', description: 'A new skill' },
        body: '# Instructions',
      })
      mockedGetHash.mockResolvedValue('commit-hash-123')

      const result = await installSkillFromGitHub('owner', 'repo', 'skills/my-new-skill')

      expect(result.success).toBe(true)
      expect(result.skillName).toBe('my-new-skill')
      expect(mockedDownload).toHaveBeenCalled()
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('source.json'),
        expect.stringContaining('"commit-hash-123"'),
        'utf-8'
      )
    })

    it('should fail when SKILL.md is missing', async () => {
      mockedDownload.mockResolvedValue(undefined)
      mockedFs.existsSync.mockReturnValue(false)

      const result = await installSkillFromGitHub('owner', 'repo', 'bad-path')

      expect(result.success).toBe(false)
      expect(result.error).toContain('No SKILL.md found')
    })

    it('should fail when SKILL.md is invalid (parseSkillFile returns null)', async () => {
      mockedDownload.mockResolvedValue(undefined)
      mockedFs.existsSync.mockImplementation((p) => {
        if (String(p).includes('SKILL.md')) return true
        return false
      })
      mockedParse.mockReturnValue(null)

      const result = await installSkillFromGitHub('owner', 'repo', '')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid SKILL.md')
    })
  })

  describe('installSkillFromMarketplace', () => {
    it('should install using detected path when skill name and directory differ by prefix', async () => {
      mockedDetect.mockResolvedValue([
        {
          name: 'react-best-practices',
          path: 'skills/react-best-practices',
          description: 'React guidance',
        },
      ])
      mockedDownload.mockResolvedValue(undefined)
      mockedFs.existsSync.mockImplementation((p) => {
        if (String(p).includes('SKILL.md')) return true
        if (String(p).includes('.tmp-')) return false
        return false
      })
      mockedParse.mockReturnValue({
        metadata: { name: 'react-best-practices', description: 'React guidance' },
        body: '# Instructions',
      })
      mockedGetHash.mockResolvedValue('hash-123')

      const result = await installSkillFromMarketplace({
        id: 'vercel-labs/agent-skills/vercel-react-best-practices',
        skillId: 'vercel-react-best-practices',
        name: 'vercel-react-best-practices',
        installs: 100,
        source: 'vercel-labs/agent-skills',
      })

      expect(result.success).toBe(true)
      expect(mockedDownload).toHaveBeenCalledWith(
        'vercel-labs',
        'agent-skills',
        'skills/react-best-practices',
        expect.any(String)
      )
    })

    it('should try fallback skill paths before root path', async () => {
      mockedDetect.mockResolvedValue([])
      let requestedSkillPath = ''
      mockedDownload.mockImplementation(async (_owner, _repo, skillPath) => {
        requestedSkillPath = skillPath
      })

      mockedFs.existsSync.mockImplementation((p) => {
        const value = String(p)
        if (value.endsWith('SKILL.md')) return requestedSkillPath === 'skills/frontend-design'
        if (value.includes('.tmp-')) return false
        if (value.includes('source.json')) return false
        return false
      })
      mockedParse.mockReturnValue({
        metadata: { name: 'frontend-design', description: 'Frontend design guidance' },
        body: '# Instructions',
      })
      mockedGetHash.mockResolvedValue('hash-456')

      const result = await installSkillFromMarketplace({
        id: 'anthropics/skills/frontend-design',
        skillId: 'frontend-design',
        name: 'frontend-design',
        installs: 100,
        source: 'anthropics/skills',
      })

      expect(result.success).toBe(true)
      const calledPaths = mockedDownload.mock.calls.map(([, , skillPath]) => skillPath)
      expect(calledPaths[0]).toBe('skills/frontend-design')
    })
  })

  describe('deleteSkill', () => {
    it('should delete existing skill successfully', async () => {
      mockedFs.existsSync.mockReturnValue(true)

      const result = await deleteSkill('my-custom-skill')

      expect(result.success).toBe(true)
      expect(mockedFs.rmSync).toHaveBeenCalledWith(expect.stringContaining('my-custom-skill'), {
        recursive: true,
        force: true,
      })
    })

    it('should fail if skill directory does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false)

      const result = await deleteSkill('nonexistent-skill')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should reject empty skill name', async () => {
      const result = await deleteSkill('')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid skill name')
    })

    it('should reject path traversal skill names', async () => {
      const result = await deleteSkill('../outside')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid skill name')
      expect(mockedFs.rmSync).not.toHaveBeenCalled()
    })
  })

  describe('checkForUpdates', () => {
    it('should reject invalid skill names', async () => {
      const result = await checkForUpdates('../outside')

      expect(result.hasUpdate).toBe(false)
      expect(result.error).toContain('Invalid skill name')
    })

    it('should detect available update when hashes differ', async () => {
      mockedFs.existsSync.mockReturnValue(true)
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          type: 'github',
          repo: 'owner/repo',
          skillPath: 'skills/test',
          commitHash: 'old-hash-111',
        })
      )
      mockedGetHash.mockResolvedValue('new-hash-222')

      const result = await checkForUpdates('test-skill')

      expect(result.hasUpdate).toBe(true)
      expect(result.currentHash).toBe('old-hash-111')
      expect(result.latestHash).toBe('new-hash-222')
    })

    it('should report no update when hashes match', async () => {
      mockedFs.existsSync.mockReturnValue(true)
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          type: 'github',
          repo: 'owner/repo',
          commitHash: 'same-hash',
        })
      )
      mockedGetHash.mockResolvedValue('same-hash')

      const result = await checkForUpdates('test-skill')

      expect(result.hasUpdate).toBe(false)
    })

    it('should return error when source.json is missing', async () => {
      mockedFs.existsSync.mockReturnValue(false)
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = await checkForUpdates('orphan-skill')

      expect(result.hasUpdate).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
