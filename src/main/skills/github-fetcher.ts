import { getLogger } from '../util'

const log = getLogger('skills:github-fetcher')

const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'chatbox-app'
const CACHE_TTL_MS = 5 * 60 * 1000

interface GitHubContentItem {
  name: string
  path: string
  type: 'file' | 'dir'
  sha: string
  download_url: string | null
}

interface GitHubCommitItem {
  sha: string
}

export interface DetectedSkill {
  name: string
  path: string
  description?: string
}

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearCache(): void {
  cache.clear()
}

class GitHubApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

async function githubFetch<T>(url: string): Promise<T> {
  const cached = getCached<T>(url)
  if (cached !== undefined) return cached

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubApiError(`Not found: ${url}`, 404)
    }
    if (response.status === 403) {
      throw new GitHubApiError('GitHub API rate limit exceeded. Try again later.', 403)
    }
    throw new GitHubApiError(`GitHub API error: ${response.status} ${response.statusText}`, response.status)
  }

  const data = (await response.json()) as T
  setCache(url, data)
  return data
}

export async function fetchRepoContents(owner: string, repo: string, repoPath = ''): Promise<GitHubContentItem[]> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${repoPath}`
  try {
    const result = await githubFetch<GitHubContentItem[] | GitHubContentItem>(url)
    return Array.isArray(result) ? result : [result]
  } catch (error) {
    if (error instanceof GitHubApiError && error.statusCode === 404) {
      return []
    }
    throw error
  }
}

// Strategy 1: root SKILL.md | 2: skills/{name}/SKILL.md | 3: {dir}/skills/{name}/SKILL.md (fallback)
export async function detectSkillsInRepo(owner: string, repo: string): Promise<DetectedSkill[]> {
  const detected: DetectedSkill[] = []

  try {
    const rootContents = await fetchRepoContents(owner, repo)
    const rootSkillMd = rootContents.find((item) => item.name === 'SKILL.md' && item.type === 'file')
    if (rootSkillMd) {
      const content = await fetchFileContent(owner, repo, 'SKILL.md')
      const name = extractSkillName(content)
      detected.push({
        name: name || repo,
        path: '',
        description: extractSkillDescription(content),
      })
    }
  } catch (error) {
    log.warn(`Failed to check root SKILL.md for ${owner}/${repo}`, error)
  }

  try {
    const skillsDirContents = await fetchRepoContents(owner, repo, 'skills')
    for (const item of skillsDirContents) {
      if (item.type !== 'dir') continue
      try {
        const subContents = await fetchRepoContents(owner, repo, `skills/${item.name}`)
        const hasSkillMd = subContents.some((f) => f.name === 'SKILL.md' && f.type === 'file')
        if (hasSkillMd) {
          const content = await fetchFileContent(owner, repo, `skills/${item.name}/SKILL.md`)
          detected.push({
            name: extractSkillName(content) || item.name,
            path: `skills/${item.name}`,
            description: extractSkillDescription(content),
          })
        }
      } catch {
        // Inaccessible skill dir
      }
    }
  } catch {
    // No skills/ directory
  }

  if (detected.length === 0) {
    try {
      const rootContents = await fetchRepoContents(owner, repo)
      const topDirs = rootContents.filter((item) => item.type === 'dir' && item.name !== 'skills')

      for (const topDir of topDirs.slice(0, 5)) {
        try {
          const nestedSkillsDir = await fetchRepoContents(owner, repo, `${topDir.name}/skills`)
          for (const item of nestedSkillsDir) {
            if (item.type !== 'dir') continue
            try {
              const subContents = await fetchRepoContents(owner, repo, `${topDir.name}/skills/${item.name}`)
              const hasSkillMd = subContents.some((f) => f.name === 'SKILL.md' && f.type === 'file')
              if (hasSkillMd) {
                const content = await fetchFileContent(owner, repo, `${topDir.name}/skills/${item.name}/SKILL.md`)
                detected.push({
                  name: extractSkillName(content) || item.name,
                  path: `${topDir.name}/skills/${item.name}`,
                  description: extractSkillDescription(content),
                })
              }
            } catch {
              // Skip
            }
          }
        } catch {
          // No nested skills/ directory
        }
      }
    } catch {
      // Root listing already failed earlier, skip
    }
  }

  return detected
}

export async function fetchFileContent(owner: string, repo: string, filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${filePath}`

  const cached = getCached<string>(url)
  if (cached !== undefined) return cached

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!response.ok) {
    throw new GitHubApiError(`Failed to fetch file: ${filePath}`, response.status)
  }

  const content = await response.text()
  setCache(url, content)
  return content
}

export async function downloadSkillFiles(
  owner: string,
  repo: string,
  skillPath: string,
  targetDir: string
): Promise<void> {
  const fs = await import('fs')
  const pathModule = await import('path')

  fs.mkdirSync(targetDir, { recursive: true })

  const contentsPath = skillPath || ''
  const contents = await fetchRepoContents(owner, repo, contentsPath)

  for (const item of contents) {
    const relativePath = skillPath ? item.path.slice(skillPath.length + 1) : item.path
    const localPath = pathModule.join(targetDir, relativePath)

    if (item.type === 'file') {
      const content = await fetchFileContent(owner, repo, item.path)
      const dir = pathModule.dirname(localPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(localPath, content, 'utf-8')
    } else if (item.type === 'dir') {
      await downloadSkillFiles(owner, repo, item.path, pathModule.join(targetDir, relativePath))
    }
  }
}

export async function getLatestCommitHash(owner: string, repo: string, repoPath: string): Promise<string | null> {
  const encodedPath = encodeURIComponent(repoPath || '.')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?path=${encodedPath}&per_page=1`

  try {
    const commits = await githubFetch<GitHubCommitItem[]>(url)
    if (commits.length > 0) {
      return commits[0].sha
    }
    return null
  } catch (error) {
    log.error(`Failed to get latest commit hash for ${owner}/${repo}/${repoPath}`, error)
    return null
  }
}

// Regex: match `name:` line inside YAML frontmatter delimited by ---
function extractSkillName(content: string): string | undefined {
  const match = content.match(/^---\s*\n[\s\S]*?^name:\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^['"]|['"]$/g, '')
}

function extractSkillDescription(content: string): string | undefined {
  const match = content.match(/^---\s*\n[\s\S]*?^description:\s*(.+?)\s*$/m)
  return match?.[1]?.replace(/^['"]|['"]$/g, '')
}
