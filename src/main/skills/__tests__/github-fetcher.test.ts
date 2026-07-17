import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  clearCache,
  detectSkillsInRepo,
  fetchFileContent,
  fetchRepoContents,
  getLatestCommitHash,
} from '../github-fetcher'

function makeResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function makeContentItem(name: string, type: 'file' | 'dir', itemPath: string) {
  return {
    name,
    path: itemPath,
    type,
    sha: 'abc123',
    download_url: type === 'file' ? `https://raw.githubusercontent.com/test/${itemPath}` : null,
  }
}

function makeSkillMdContent(skillName: string, description = 'A test skill') {
  return `---\nname: ${skillName}\ndescription: ${description}\n---\n# Instructions\nDo something.`
}

describe('github-fetcher', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    clearCache()
  })

  afterEach(() => {
    clearCache()
  })

  describe('fetchRepoContents', () => {
    it('should return contents array from GitHub API', async () => {
      const items = [makeContentItem('SKILL.md', 'file', 'SKILL.md'), makeContentItem('README.md', 'file', 'README.md')]
      mockFetch.mockResolvedValueOnce(makeResponse(items))

      const result = await fetchRepoContents('owner', 'repo')
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('SKILL.md')
    })

    it('should return empty array on 404', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const result = await fetchRepoContents('owner', 'repo', 'nonexistent')
      expect(result).toEqual([])
    })
  })

  describe('detectSkillsInRepo', () => {
    it('should detect root SKILL.md', async () => {
      const rootContents = [makeContentItem('SKILL.md', 'file', 'SKILL.md')]
      const skillMdContent = makeSkillMdContent('my-skill', 'A great skill')

      // 1st call: fetchRepoContents for root
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents))
      // 2nd call: fetchFileContent for SKILL.md
      mockFetch.mockResolvedValueOnce(makeResponse(skillMdContent, 200, true))
      // 3rd call: fetchRepoContents for skills/ dir → 404
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('my-skill')
      expect(detected[0].path).toBe('')
    })

    it('should detect skills in skills/ directory (flat structure)', async () => {
      const rootContents = [makeContentItem('skills', 'dir', 'skills')]
      const skillsDirContents = [makeContentItem('my-tool', 'dir', 'skills/my-tool')]
      const subContents = [makeContentItem('SKILL.md', 'file', 'skills/my-tool/SKILL.md')]
      const skillMd = makeSkillMdContent('my-tool', 'Tool description')

      // root contents (no root SKILL.md)
      mockFetch.mockResolvedValueOnce(makeResponse(rootContents))
      // skills/ directory listing
      mockFetch.mockResolvedValueOnce(makeResponse(skillsDirContents))
      // skills/my-tool/ subdir listing
      mockFetch.mockResolvedValueOnce(makeResponse(subContents))
      // SKILL.md content
      mockFetch.mockResolvedValueOnce(makeResponse(skillMd, 200, true))

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('my-tool')
      expect(detected[0].path).toBe('skills/my-tool')
    })

    it('should detect nested skills (domain/skills/name pattern)', async () => {
      const rootContents = [makeContentItem('domain', 'dir', 'domain')]
      const nestedSkillsDir = [makeContentItem('nested-skill', 'dir', 'domain/skills/nested-skill')]
      const subContents = [makeContentItem('SKILL.md', 'file', 'domain/skills/nested-skill/SKILL.md')]
      const skillMd = makeSkillMdContent('nested-skill', 'Nested description')

      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root (cached for strategy 3 re-use)
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false)) // skills/ → 404
      // strategy 3 re-fetches root but it's cached — no mock needed
      mockFetch.mockResolvedValueOnce(makeResponse(nestedSkillsDir)) // domain/skills/
      mockFetch.mockResolvedValueOnce(makeResponse(subContents)) // domain/skills/nested-skill/
      mockFetch.mockResolvedValueOnce(makeResponse(skillMd, 200, true)) // SKILL.md content

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toHaveLength(1)
      expect(detected[0].name).toBe('nested-skill')
      expect(detected[0].path).toBe('domain/skills/nested-skill')
    })

    it('should return empty array for repo with no skills', async () => {
      const rootContents = [makeContentItem('README.md', 'file', 'README.md')]

      mockFetch.mockResolvedValueOnce(makeResponse(rootContents)) // root (cached)
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false)) // skills/ → 404
      // strategy 3 re-fetches root from cache; rootContents has no dirs → no further calls

      const detected = await detectSkillsInRepo('owner', 'repo')
      expect(detected).toEqual([])
    })
  })

  describe('fetchFileContent', () => {
    it('should fetch and return file content', async () => {
      const content = '# Hello World'
      mockFetch.mockResolvedValueOnce(makeResponse(content, 200, true))

      const result = await fetchFileContent('owner', 'repo', 'README.md')
      expect(result).toBe(content)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/owner/repo/HEAD/README.md',
        expect.objectContaining({ headers: expect.any(Object) })
      )
    })

    it('should throw GitHubApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      await expect(fetchFileContent('owner', 'repo', 'missing.md')).rejects.toThrow('Failed to fetch file')
    })
  })

  describe('getLatestCommitHash', () => {
    it('should return latest commit sha', async () => {
      const commits = [{ sha: 'abc123def456' }]
      mockFetch.mockResolvedValueOnce(makeResponse(commits))

      const hash = await getLatestCommitHash('owner', 'repo', 'skills/my-skill')
      expect(hash).toBe('abc123def456')
    })

    it('should return null on empty commits', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]))

      const hash = await getLatestCommitHash('owner', 'repo', '')
      expect(hash).toBeNull()
    })

    it('should return null on error', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 500, false))

      const hash = await getLatestCommitHash('owner', 'repo', 'path')
      expect(hash).toBeNull()
    })
  })

  describe('API error handling', () => {
    it('should throw GitHubApiError with rate limit message on 403', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 403, false))

      await expect(fetchRepoContents('owner', 'repo')).rejects.toThrow('rate limit')
    })

    it('should handle 404 gracefully in fetchRepoContents', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(null, 404, false))

      const result = await fetchRepoContents('owner', 'repo', 'missing')
      expect(result).toEqual([])
    })
  })
})
