import type { MarketplaceSkill, SkillInfo, SkillMetadata } from '@shared/types/skills'
import platform from '@/platform'

const MOBILE_SKILLS_KEY = 'yachiyo-mobile-skills-v1'

interface MobileSkillRecord {
  metadata: SkillMetadata
  body: string
  repo?: string
  skillPath?: string
  installedAt: string
}

function readMobileSkills(): MobileSkillRecord[] {
  try {
    return JSON.parse(localStorage.getItem(MOBILE_SKILLS_KEY) || '[]') as MobileSkillRecord[]
  } catch {
    return []
  }
}

function writeMobileSkills(skills: MobileSkillRecord[]): void {
  localStorage.setItem(MOBILE_SKILLS_KEY, JSON.stringify(skills))
}

function parseMobileSkill(content: string, fallbackName: string): { metadata: SkillMetadata; body: string } | null {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  const header = frontmatter?.[1] || ''
  const body = (frontmatter?.[2] || content).trim()
  const name = header.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() || fallbackName
  const description = header.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim() || `Skill ${name}`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) return null
  return { metadata: { name, description: description.slice(0, 1024) }, body }
}

async function installMobileGitHubSkill(owner: string, repo: string, skillPath: string): Promise<SkillInstallResult> {
  const normalizedPath = skillPath.replace(/^\/+|\/+$/g, '')
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${normalizedPath ? `${normalizedPath}/` : ''}SKILL.md`
  const response = await fetch(rawUrl)
  if (!response.ok) return { success: false, skillName: normalizedPath || repo, error: `HTTP ${response.status}` }
  const parsed = parseMobileSkill(await response.text(), normalizedPath.split('/').pop() || repo.toLowerCase())
  if (!parsed) return { success: false, skillName: normalizedPath || repo, error: 'Invalid SKILL.md' }
  const current = readMobileSkills().filter((skill) => skill.metadata.name !== parsed.metadata.name)
  current.push({
    ...parsed,
    repo: `${owner}/${repo}`,
    skillPath: normalizedPath,
    installedAt: new Date().toISOString(),
  })
  writeMobileSkills(current)
  return { success: true, skillName: parsed.metadata.name }
}

interface SkillScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

interface SkillInstallResult {
  success: boolean
  skillName: string
  error?: string
}

interface SkillUpdateResult {
  hasUpdate: boolean
  currentHash?: string
  latestHash?: string
  error?: string
}

export const skillsController = {
  saveSkill(metadata: SkillMetadata, body: string): Promise<SkillInstallResult> {
    if (platform.type !== 'mobile') {
      return Promise.resolve({ success: false, skillName: metadata.name, error: 'Use the desktop skills directory' })
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || !metadata.description.trim() || !body.trim()) {
      return Promise.resolve({ success: false, skillName: metadata.name, error: 'Invalid skill metadata or body' })
    }
    const current = readMobileSkills().filter((skill) => skill.metadata.name !== metadata.name)
    current.push({ metadata, body: body.trim(), installedAt: new Date().toISOString() })
    writeMobileSkills(current)
    return Promise.resolve({ success: true, skillName: metadata.name })
  },

  discoverSkills(): Promise<SkillInfo[]> {
    if (platform.type === 'mobile') {
      return Promise.resolve(
        readMobileSkills().map((skill) => ({
          ...skill.metadata,
          path: `mobile://skills/${skill.metadata.name}`,
          isBuiltin: false,
          bodyTokenEstimate: Math.ceil(skill.body.length / 4),
          source: {
            type: skill.repo ? 'github' : 'local',
            repo: skill.repo,
            installedAt: skill.installedAt,
            skillPath: skill.skillPath,
          },
        }))
      )
    }
    return window.electronAPI.invoke('skills:discover')
  },

  loadSkill(name: string): Promise<{ metadata: SkillMetadata; body: string } | null> {
    if (platform.type === 'mobile') {
      const skill = readMobileSkills().find((candidate) => candidate.metadata.name === name)
      return Promise.resolve(skill ? { metadata: skill.metadata, body: skill.body } : null)
    }
    return window.electronAPI.invoke('skills:load', name)
  },

  getSkillsDirectory(): Promise<string> {
    if (platform.type === 'mobile') return Promise.resolve('Yachiyo Claw / Skills')
    return window.electronAPI.invoke('skills:get-directory')
  },

  async openSkillsDirectory(): Promise<void> {
    if (platform.type === 'mobile') return
    await window.electronAPI.invoke('skills:open-directory')
  },

  executeScript(skillName: string, scriptName: string, args?: string[]): Promise<SkillScriptResult> {
    if (platform.type === 'mobile') {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: `移动端 Skill 脚本执行尚未启用：${skillName}/${scriptName}`,
        exitCode: 126,
      })
    }
    return window.electronAPI.invoke('skills:execute-script', { skillName, scriptName, args })
  },

  installSkill(owner: string, repo: string, skillPath: string): Promise<SkillInstallResult> {
    if (platform.type === 'mobile') return installMobileGitHubSkill(owner, repo, skillPath)
    return window.electronAPI.invoke('skills:install', { owner, repo, skillPath })
  },

  installMarketplaceSkill(skill: MarketplaceSkill): Promise<SkillInstallResult> {
    if (platform.type === 'mobile') {
      const match = skill.source.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/)
      return match
        ? installMobileGitHubSkill(match[1], match[2].replace(/\.git$/, ''), match[3] || '')
        : Promise.resolve({ success: false, skillName: skill.name, error: 'Only GitHub skills are supported on Android' })
    }
    return window.electronAPI.invoke('skills:install-marketplace', skill)
  },

  deleteSkill(name: string): Promise<{ success: boolean; error?: string }> {
    if (platform.type === 'mobile') {
      writeMobileSkills(readMobileSkills().filter((skill) => skill.metadata.name !== name))
      return Promise.resolve({ success: true })
    }
    return window.electronAPI.invoke('skills:delete', name)
  },

  scanRepo(owner: string, repo: string): Promise<Array<{ name: string; path: string; description?: string }>> {
    if (platform.type === 'mobile') {
      return fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json() as Promise<{ tree?: Array<{ path: string; type: string }> }>
        })
        .then((data) =>
          (data.tree || [])
            .filter((entry) => entry.type === 'blob' && entry.path.endsWith('/SKILL.md'))
            .map((entry) => {
              const path = entry.path.slice(0, -'/SKILL.md'.length)
              return { name: path.split('/').pop() || repo, path }
            })
        )
    }
    return window.electronAPI.invoke('skills:scan-repo', owner, repo)
  },

  checkForUpdate(name: string): Promise<SkillUpdateResult> {
    if (platform.type === 'mobile') return Promise.resolve({ hasUpdate: false })
    return window.electronAPI.invoke('skills:check-update', name)
  },

  checkForUpdatesBatch(): Promise<Record<string, { hasUpdate: boolean; error?: string }>> {
    if (platform.type === 'mobile') return Promise.resolve({})
    return window.electronAPI.invoke('skills:check-updates-batch')
  },
}
