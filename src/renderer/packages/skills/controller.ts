import { inspectSkillArchive, SkillHubAdapter, sha256Hex } from '@shared/skills'
import type {
  MarketplaceSkill,
  SkillFileManifest,
  SkillInfo,
  SkillInstallRecord,
  SkillMetadata,
  SkillSource,
  SkillExecutionMode,
  SkillScriptCapability,
  SkillScriptEntrypoint,
} from '@shared/types/skills'
import { SkillExecutableManifestSchema } from '@shared/types/skills'
import JSZip from 'jszip'
import platform from '@/platform'
import { executeMobileSkillScript } from '@/mobile/mobile-skill-script'

const MOBILE_SKILLS_KEY = 'yachiyo-mobile-skills-v1'

interface MobileSkillRecord {
  metadata: SkillMetadata
  body: string
  repo?: string
  skillPath?: string
  installedAt: string
  source?: SkillSource
  installRecord?: SkillInstallRecord
  executionMode?: SkillExecutionMode
  scriptFiles?: Record<string, { entrypoint: SkillScriptEntrypoint; scriptBase64: string }>
  grantedScriptCapabilities?: SkillScriptCapability[]
}

function validMobileSkills(value: unknown): MobileSkillRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is MobileSkillRecord => {
    const item = entry as Partial<MobileSkillRecord>
    return !!item?.metadata && typeof item.metadata.name === 'string' && typeof item.body === 'string'
  })
}

async function readMobileSkills(): Promise<MobileSkillRecord[]> {
  try {
    const stored = validMobileSkills(await platform.getStoreValue(MOBILE_SKILLS_KEY))
    if (stored.length) return stored
    const legacy = typeof localStorage === 'undefined' ? [] : validMobileSkills(JSON.parse(localStorage.getItem(MOBILE_SKILLS_KEY) || '[]'))
    if (legacy.length) {
      await platform.setStoreValue(MOBILE_SKILLS_KEY, legacy)
      localStorage.removeItem(MOBILE_SKILLS_KEY)
    }
    return legacy
  } catch {
    return []
  }
}

async function writeMobileSkills(skills: MobileSkillRecord[]): Promise<void> {
  await platform.setStoreValue(MOBILE_SKILLS_KEY, skills)
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
  const installedAt = new Date().toISOString()
  const current = (await readMobileSkills()).filter((skill) => skill.metadata.name !== parsed.metadata.name)
  current.push({
    ...parsed,
    repo: `${owner}/${repo}`,
    skillPath: normalizedPath,
    installedAt,
    executionMode: 'declarative',
    source: { type: 'github', repo: `${owner}/${repo}`, skillPath: normalizedPath, installedAt },
  })
  await writeMobileSkills(current)
  return { success: true, skillName: parsed.metadata.name }
}

function isSkillHubSkill(skill: MarketplaceSkill): boolean {
  try {
    const host = new URL(skill.source).hostname.toLowerCase()
    return host === 'skillhub.cn' || host.endsWith('.skillhub.cn')
  } catch {
    return skill.source.startsWith('skillhub:')
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function decodeSkillHubPackage(
  download: Awaited<ReturnType<SkillHubAdapter['download']>>,
  allowScripts: boolean
) {
  const bytes = new Uint8Array(download.bytes)
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Skill package exceeds the mobile size limit')
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) {
    inspectSkillArchive([{ path: 'SKILL.md', size: bytes.byteLength }])
    return {
      content: new TextDecoder().decode(bytes),
      files: [{ path: 'SKILL.md', size: bytes.byteLength }],
      scriptFiles: {} as Record<string, { entrypoint: SkillScriptEntrypoint; scriptBase64: string }>,
    }
  }
  const zip = await JSZip.loadAsync(bytes)
  const entries: Array<{ path: string; size: number; type?: 'file' | 'directory' | 'symlink' }> = []
  const files: SkillFileManifest[] = []
  let content = ''
  let skillMdPath = ''
  let expandedSize = 0
  const contents = new Map<string, Uint8Array>()
  for (const [relativePath, file] of Object.entries(zip.files)) {
    const path = (file.unsafeOriginalName || relativePath).replace(/\\/g, '/')
    const unixPermissions = typeof file.unixPermissions === 'number' ? file.unixPermissions : 0
    const type = (unixPermissions & 0o170000) === 0o120000 ? 'symlink' : file.dir ? 'directory' : 'file'
    const data = file.dir ? new Uint8Array() : await file.async('uint8array')
    expandedSize += data.byteLength
    if (expandedSize > 32 * 1024 * 1024) throw new Error('Skill package expands beyond the mobile size limit')
    entries.push({ path, size: data.byteLength, type })
    if (!file.dir) {
      files.push({ path, size: data.byteLength, sha256: await sha256Hex(data) })
      contents.set(path, data)
    }
    if (!file.dir && path.split('/').at(-1)?.toLowerCase() === 'skill.md') {
      if (skillMdPath) throw new Error('Skill package must contain exactly one SKILL.md')
      skillMdPath = path
      content = new TextDecoder().decode(data)
    }
  }
  inspectSkillArchive(entries, { allowScripts })
  if (!content) throw new Error('Skill package does not contain SKILL.md')
  const skillRoot = skillMdPath.includes('/') ? skillMdPath.slice(0, skillMdPath.lastIndexOf('/') + 1) : ''
  const manifestPath = `${skillRoot}yachiyo-skill.json`
  const manifestBytes = contents.get(manifestPath)
  if (!allowScripts) {
    if (manifestBytes) throw new Error('Executable manifest requires the scripts capability')
    return { content, files, scriptFiles: {} as Record<string, { entrypoint: SkillScriptEntrypoint; scriptBase64: string }> }
  }
  if (!manifestBytes) throw new Error('Script Skill package must contain yachiyo-skill.json next to SKILL.md')
  const manifest = SkillExecutableManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)))
  const scriptFiles: Record<string, { entrypoint: SkillScriptEntrypoint; scriptBase64: string }> = {}
  for (const entrypoint of manifest.entrypoints) {
    const scriptBytes = contents.get(`${skillRoot}${entrypoint.path}`)
    if (!scriptBytes) throw new Error(`Missing declared Skill script: ${entrypoint.path}`)
    if (scriptBytes.byteLength !== entrypoint.size) throw new Error(`Skill script size mismatch: ${entrypoint.name}`)
    if ((await sha256Hex(scriptBytes)) !== entrypoint.sha256.toLowerCase()) {
      throw new Error(`Skill script hash mismatch: ${entrypoint.name}`)
    }
    scriptFiles[entrypoint.name] = { entrypoint, scriptBase64: encodeBase64(scriptBytes) }
  }
  return { content, files, scriptFiles }
}

export async function installMobileSkillHubSkill(
  skill: MarketplaceSkill,
  options: { adapter?: SkillHubAdapter; requireSignature?: boolean } = {}
): Promise<SkillInstallResult> {
  try {
    const adapter = options.adapter || new SkillHubAdapter()
    const slug = skill.slug || skill.skillId
    const details = await adapter.getSkill(slug).catch(() => skill)
    if (!details.revision) throw new Error('SkillHub package must pin an immutable revision')
    const download = await adapter.download(slug, details.revision)
    const integrity = await adapter.verifyDownload(download, details)
    if (options.requireSignature && !integrity.signatureVerified) throw new Error('SkillHub signature is required')
    const scriptsRequested = details.capabilityManifest?.scripts === true
    const decoded = await decodeSkillHubPackage(download, scriptsRequested)
    if (scriptsRequested && Object.keys(decoded.scriptFiles).length === 0) {
      throw new Error('Script Skill packages must be ZIP archives with a validated executable manifest')
    }
    const entrypoints = Object.values(decoded.scriptFiles).map((script) => script.entrypoint)
    const declaredCapabilities = details.capabilityManifest || {}
    for (const entrypoint of entrypoints) {
      for (const capability of entrypoint.capabilities) {
        if (capability === 'unrestricted-privileged' && !declaredCapabilities.privileged) {
          throw new Error(`Script entrypoint ${entrypoint.name} uses undeclared capability: ${capability}`)
        }
      }
    }
    const parsed = parseMobileSkill(decoded.content, slug)
    if (!parsed) throw new Error('Invalid SKILL.md')
    const now = new Date().toISOString()
    const source: SkillSource = {
      type: 'skillhub',
      repo: details.source,
      slug,
      version: details.version,
      revision: details.revision,
      filesHash: integrity.sha256,
      signature: details.signature,
      publisher: details.publisher,
      capabilityManifest: {
        ...details.capabilityManifest,
        scripts: scriptsRequested,
        scriptEntrypoints: entrypoints.length ? entrypoints : undefined,
      },
      installedAt: now,
    }
    const installRecord: SkillInstallRecord = {
      id: `skillhub:${slug}`,
      slug,
      name: parsed.metadata.name,
      version: details.version,
      revision: details.revision,
      source,
      files: decoded.files,
      contentHash: integrity.sha256 || (await sha256Hex(download.bytes)),
      signatureVerified: integrity.signatureVerified,
      executionMode: scriptsRequested ? 'script-disabled' : 'declarative',
      enabled: true,
      installedAt: now,
      updatedAt: now,
    }
    const current = (await readMobileSkills()).filter((entry) => entry.metadata.name !== parsed.metadata.name)
    current.push({
      ...parsed,
      installedAt: now,
      source,
      installRecord,
      executionMode: scriptsRequested ? 'script-disabled' : 'declarative',
      scriptFiles: decoded.scriptFiles,
      grantedScriptCapabilities: [],
    })
    await writeMobileSkills(current)
    return { success: true, skillName: parsed.metadata.name }
  } catch (error) {
    return { success: false, skillName: skill.name, error: error instanceof Error ? error.message : String(error) }
  }
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
  async saveSkill(metadata: SkillMetadata, body: string): Promise<SkillInstallResult> {
    if (platform.type !== 'mobile') {
      return { success: false, skillName: metadata.name, error: 'Use the desktop skills directory' }
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || !metadata.description.trim() || !body.trim()) {
      return { success: false, skillName: metadata.name, error: 'Invalid skill metadata or body' }
    }
    const current = (await readMobileSkills()).filter((skill) => skill.metadata.name !== metadata.name)
    const installedAt = new Date().toISOString()
    current.push({ metadata, body: body.trim(), installedAt, executionMode: 'declarative', source: { type: 'local', installedAt } })
    await writeMobileSkills(current)
    return { success: true, skillName: metadata.name }
  },

  async discoverSkills(): Promise<SkillInfo[]> {
    if (platform.type === 'mobile') {
      return (await readMobileSkills()).map((skill) => ({
          ...skill.metadata,
          path: `mobile://skills/${skill.metadata.name}`,
          isBuiltin: false,
          bodyTokenEstimate: Math.ceil(skill.body.length / 4),
          source: skill.source || {
            type: skill.repo ? 'github' : 'local',
            repo: skill.repo,
            installedAt: skill.installedAt,
            skillPath: skill.skillPath,
          },
          scriptExecutionEnabled: skill.executionMode === 'script-enabled',
          signatureVerified: skill.installRecord?.signatureVerified,
        }))
    }
    return window.electronAPI.invoke('skills:discover')
  },

  async loadSkill(name: string): Promise<{ metadata: SkillMetadata; body: string } | null> {
    if (platform.type === 'mobile') {
      const skill = (await readMobileSkills()).find((candidate) => candidate.metadata.name === name)
      return skill ? { metadata: skill.metadata, body: skill.body } : null
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

  async executeScript(
    skillName: string,
    scriptName: string,
    args?: string[],
    context: { sessionId?: string; toolCallId?: string; abortSignal?: AbortSignal } = {}
  ): Promise<SkillScriptResult> {
    if (platform.type === 'mobile') {
      const skill = (await readMobileSkills()).find((candidate) => candidate.metadata.name === skillName)
      if (!skill) return { success: false, stdout: '', stderr: 'skill_not_installed', exitCode: 127 }
      if (skill.executionMode !== 'script-enabled') {
        return { success: false, stdout: '', stderr: 'skill_script_execution_disabled', exitCode: 126 }
      }
      const script = skill.scriptFiles?.[scriptName]
      if (!script) return { success: false, stdout: '', stderr: 'skill_script_not_declared', exitCode: 127 }
      try {
        return await executeMobileSkillScript({
          skillName,
          script,
          args,
          grantedCapabilities: skill.grantedScriptCapabilities || [],
          signatureVerified: skill.installRecord?.signatureVerified === true,
          ...context,
        })
      } catch (error) {
        return {
          success: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        }
      }
    }
    return window.electronAPI.invoke('skills:execute-script', { skillName, scriptName, args })
  },

  async configureScriptExecution(
    skillName: string,
    enabled: boolean,
    grantedCapabilities: SkillScriptCapability[] = []
  ): Promise<{ success: boolean; error?: string }> {
    if (platform.type !== 'mobile') return { success: false, error: 'mobile_only' }
    const current = await readMobileSkills()
    const index = current.findIndex((candidate) => candidate.metadata.name === skillName)
    if (index < 0) return { success: false, error: 'skill_not_installed' }
    const skill = current[index]
    const scripts = Object.values(skill.scriptFiles || {})
    if (!scripts.length) return { success: false, error: 'skill_has_no_declared_scripts' }
    const normalizedGrants = Array.from(new Set(grantedCapabilities))
    const required = Array.from(new Set(scripts.flatMap((script) => script.entrypoint.capabilities)))
    if (enabled && required.some((capability) => !normalizedGrants.includes(capability))) {
      return { success: false, error: `missing_skill_capabilities:${required.join(',')}` }
    }
    current[index] = {
      ...skill,
      executionMode: enabled ? 'script-enabled' : 'script-disabled',
      grantedScriptCapabilities: enabled ? normalizedGrants : [],
      installRecord: skill.installRecord
        ? {
            ...skill.installRecord,
            executionMode: enabled ? 'script-enabled' : 'script-disabled',
            updatedAt: new Date().toISOString(),
          }
        : undefined,
    }
    await writeMobileSkills(current)
    return { success: true }
  },

  installSkill(owner: string, repo: string, skillPath: string): Promise<SkillInstallResult> {
    if (platform.type === 'mobile') return installMobileGitHubSkill(owner, repo, skillPath)
    return window.electronAPI.invoke('skills:install', { owner, repo, skillPath })
  },

  installMarketplaceSkill(skill: MarketplaceSkill): Promise<SkillInstallResult> {
    if (platform.type === 'mobile') {
      if (isSkillHubSkill(skill)) return installMobileSkillHubSkill(skill)
      const match = skill.source.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/)
      return match
        ? installMobileGitHubSkill(match[1], match[2].replace(/\.git$/, ''), match[3] || '')
        : Promise.resolve({ success: false, skillName: skill.name, error: 'Only GitHub skills are supported on Android' })
    }
    return window.electronAPI.invoke('skills:install-marketplace', skill)
  },

  async deleteSkill(name: string): Promise<{ success: boolean; error?: string }> {
    if (platform.type === 'mobile') {
      await writeMobileSkills((await readMobileSkills()).filter((skill) => skill.metadata.name !== name))
      return { success: true }
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
