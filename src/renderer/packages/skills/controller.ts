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
import {
  readCompletedDownload,
  yachiyoDownloadsNative,
  type GenericDownloadRequest,
} from '@/platform/native/yachiyo_downloads'
import { executeMobileSkillScript } from '@/mobile/mobile-skill-script'

const MOBILE_SKILLS_KEY = 'yachiyo-mobile-skills-v1'
const MOBILE_SKILL_INSTALLS_KEY = 'yachiyo-mobile-skill-installs-v1'
const MAX_MOBILE_SKILL_BYTES = 32 * 1024 * 1024

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

type PendingSkillInstallState = 'prepared' | 'enqueued' | 'installed'

interface PendingSkillInstallBase {
  schemaVersion: 1
  taskId: string
  state: PendingSkillInstallState
  createdAt: string
  updatedAt: string
  descriptor: {
    url: string
    sizeBytes: number
    sha256?: string
    contentType?: string
    signature?: MarketplaceSkill['signature']
  }
  lastError?: string
}

interface PendingGitHubSkillInstall extends PendingSkillInstallBase {
  sourceType: 'github'
  owner: string
  repo: string
  skillPath: string
  revision: string
}

interface PendingSkillHubInstall extends PendingSkillInstallBase {
  sourceType: 'skillhub'
  skill: MarketplaceSkill
  requireSignature: boolean
}

type PendingSkillInstall = PendingGitHubSkillInstall | PendingSkillHubInstall

function validPendingSkillInstalls(value: unknown): PendingSkillInstall[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is PendingSkillInstall => {
    const item = entry as Partial<PendingSkillInstall>
    const common =
      item?.schemaVersion === 1 &&
      typeof item.taskId === 'string' &&
      /^skill-[A-Za-z0-9._-]{1,93}$/.test(item.taskId) &&
      (item.state === 'prepared' || item.state === 'enqueued' || item.state === 'installed') &&
      (item.sourceType === 'github' || item.sourceType === 'skillhub') &&
      typeof item.descriptor?.url === 'string' &&
      Number.isSafeInteger(item.descriptor?.sizeBytes) &&
      Number(item.descriptor?.sizeBytes) > 0 &&
      Number(item.descriptor?.sizeBytes) <= MAX_MOBILE_SKILL_BYTES
    if (!common) return false
    if (item.sourceType === 'github') {
      const github = item as Partial<PendingGitHubSkillInstall>
      return (
        typeof github.owner === 'string' &&
        typeof github.repo === 'string' &&
        typeof github.skillPath === 'string' &&
        typeof github.revision === 'string' &&
        /^[a-f0-9]{40}$/.test(github.revision)
      )
    }
    const skillhub = item as Partial<PendingSkillHubInstall>
    return (
      typeof skillhub.skill?.name === 'string' &&
      typeof skillhub.skill?.skillId === 'string' &&
      typeof skillhub.skill?.revision === 'string' &&
      typeof skillhub.requireSignature === 'boolean'
    )
  })
}

async function readPendingSkillInstalls(): Promise<PendingSkillInstall[]> {
  try {
    return validPendingSkillInstalls(await platform.getStoreValue(MOBILE_SKILL_INSTALLS_KEY))
  } catch {
    return []
  }
}

let pendingInstallMutation = Promise.resolve()

async function mutatePendingSkillInstalls(
  mutation: (current: PendingSkillInstall[]) => PendingSkillInstall[]
): Promise<void> {
  const operation = pendingInstallMutation.then(async () => {
    await platform.setStoreValue(MOBILE_SKILL_INSTALLS_KEY, mutation(await readPendingSkillInstalls()))
  })
  pendingInstallMutation = operation.catch(() => undefined)
  return operation
}

async function persistPendingSkillInstall(context: PendingSkillInstall, preserveState = false): Promise<PendingSkillInstall> {
  let persisted = context
  await mutatePendingSkillInstalls((current) => {
    const existing = current.find((item) => item.taskId === context.taskId)
    persisted = existing && preserveState ? { ...context, state: existing.state, createdAt: existing.createdAt } : context
    return [...current.filter((item) => item.taskId !== context.taskId), persisted]
  })
  return persisted
}

async function updatePendingSkillInstall(
  taskId: string,
  patch: Partial<Pick<PendingSkillInstall, 'state' | 'lastError' | 'updatedAt'>>
): Promise<void> {
  await mutatePendingSkillInstalls((current) =>
    current.map((item) => (item.taskId === taskId ? ({ ...item, ...patch } as PendingSkillInstall) : item))
  )
}

async function removePendingSkillInstall(taskId: string): Promise<void> {
  await mutatePendingSkillInstalls((current) => current.filter((item) => item.taskId !== taskId))
}

export async function stableMobileSkillTaskId(sourceType: 'github' | 'skillhub', identity: string): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(`${sourceType}\n${identity}`))
  return `skill-${sourceType}-${digest.slice(0, 40)}`
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

let mobileSkillMutation = Promise.resolve()

async function mutateMobileSkills(mutation: (current: MobileSkillRecord[]) => MobileSkillRecord[]): Promise<void> {
  const operation = mobileSkillMutation.then(async () => writeMobileSkills(mutation(await readMobileSkills())))
  mobileSkillMutation = operation.catch(() => undefined)
  return operation
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
  const fallbackName = skillPath.replace(/^\/+|\/+$/g, '') || repo
  try {
    const context = await prepareGitHubSkillInstall(owner, repo, skillPath)
    const persisted = await persistPendingSkillInstall(context, true)
    return await runPendingSkillInstall(persisted, { wait: true, userInitiated: true })
  } catch (error) {
    return { success: false, skillName: fallbackName, error: error instanceof Error ? error.message : String(error) }
  }
}

async function probePersistentDownloadSize(url: string): Promise<number> {
  const { size } = await yachiyoDownloadsNative.probe({ url, maximumBytes: MAX_MOBILE_SKILL_BYTES })
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MOBILE_SKILL_BYTES) {
    throw new Error('Skill package size is missing or exceeds the mobile limit')
  }
  return size
}

async function checkMobileSkillUpdate(name: string): Promise<SkillUpdateResult> {
  const skill = (await readMobileSkills()).find((candidate) => candidate.metadata.name === name)
  if (!skill) return { hasUpdate: false, error: 'skill_not_installed' }
  const source = skill.source
  if (source?.type === 'github' && source.repo) {
    const [owner, repo, extra] = source.repo.split('/')
    if (!owner || !repo || extra) return { hasUpdate: false, error: 'skill_update_source_invalid' }
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return { hasUpdate: false, error: `GitHub HTTP ${response.status}` }
    const latest = String(((await response.json()) as { sha?: unknown }).sha || '').toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(latest)) return { hasUpdate: false, error: 'skill_update_revision_invalid' }
    const current = (source.revision || source.commitHash || '').toLowerCase()
    return { hasUpdate: Boolean(current && current !== latest), currentHash: current, latestHash: latest }
  }
  if (source?.type === 'skillhub' && source.slug) {
    try {
      const latest = await new SkillHubAdapter().getSkill(source.slug)
      const currentRevision = source.revision || ''
      const latestRevision = latest.revision || ''
      if (currentRevision && latestRevision) {
        return {
          hasUpdate: currentRevision !== latestRevision,
          currentHash: currentRevision,
          latestHash: latestRevision,
        }
      }
      return { hasUpdate: Boolean(source.version && latest.version && source.version !== latest.version) }
    } catch (error) {
      return { hasUpdate: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { hasUpdate: false, error: '本地创建的 Skill 没有远程更新源。' }
}

async function prepareGitHubSkillInstall(
  owner: string,
  repo: string,
  skillPath: string
): Promise<PendingGitHubSkillInstall> {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw new Error('Invalid GitHub repository')
  }
  const normalizedPath = skillPath.replace(/^\/+|\/+$/g, '')
  if (
    normalizedPath &&
    (normalizedPath.includes('\\') ||
      normalizedPath.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
  ) {
    throw new Error('Invalid GitHub Skill path')
  }
  const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!commitResponse.ok) throw new Error(`GitHub revision lookup failed (HTTP ${commitResponse.status})`)
  const revision = String(((await commitResponse.json()) as { sha?: unknown }).sha || '').toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('GitHub revision lookup returned an invalid commit')
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${revision}/${normalizedPath ? `${normalizedPath}/` : ''}SKILL.md`
  const sizeBytes = await probePersistentDownloadSize(url)
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    taskId: await stableMobileSkillTaskId('github', `${owner}/${repo}\n${revision}\n${normalizedPath}`),
    state: 'prepared',
    sourceType: 'github',
    owner,
    repo,
    skillPath: normalizedPath,
    revision,
    descriptor: { url, sizeBytes, contentType: 'text/markdown' },
    createdAt: now,
    updatedAt: now,
  }
}

function isSkillHubSkill(skill: MarketplaceSkill): boolean {
  try {
    const host = new URL(skill.source).hostname.toLowerCase()
    return host === 'skillhub.cn' || host.endsWith('.skillhub.cn')
  } catch {
    return skill.source.startsWith('skillhub:')
  }
}

export interface MarketplaceGitHubLocation {
  owner: string
  repo: string
  suggestedPath: string
}

export function parseMarketplaceGitHubLocation(source: string): MarketplaceGitHubLocation | null {
  const value = source.trim()
  if (!value) return null
  let parts: string[]
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const host = url.hostname.toLowerCase()
    if (host === 'github.com' || host === 'www.github.com') {
      parts = url.pathname.split('/').filter(Boolean)
      const treeIndex = parts[2] === 'tree' || parts[2] === 'blob' ? 4 : 2
      return parts.length >= 2
        ? { owner: parts[0], repo: parts[1].replace(/\.git$/i, ''), suggestedPath: parts.slice(treeIndex).join('/') }
        : null
    }
    if (host === 'skills.sh' || host === 'www.skills.sh') {
      parts = url.pathname.split('/').filter(Boolean)
      return parts.length >= 2
        ? { owner: parts[0], repo: parts[1].replace(/\.git$/i, ''), suggestedPath: parts.slice(2).join('/') }
        : null
    }
    // A bare owner/repo source is parsed with owner as the temporary host.
    if (!value.includes('://') && /^[\w.-]+\/[\w.-]+(?:\/.*)?$/.test(value)) {
      parts = value.split('/').filter(Boolean)
      return { owner: parts[0], repo: parts[1].replace(/\.git$/i, ''), suggestedPath: parts.slice(2).join('/') }
    }
    return null
  } catch {
    return null
  }
}

function skillPathBasename(path: string): string {
  return path.split('/').filter(Boolean).at(-1)?.toLowerCase() || ''
}

export function selectMarketplaceSkillPath(
  skill: MarketplaceSkill,
  location: MarketplaceGitHubLocation,
  candidates: Array<{ path: string }>
): string | null {
  const suggested = location.suggestedPath.replace(/^\/+|\/+$/g, '').replace(/\/SKILL\.md$/i, '')
  if (candidates.some((candidate) => candidate.path === suggested)) return suggested
  const names = new Set(
    [skill.slug, skill.skillId, skill.id.split('/').at(-1), suggested.split('/').at(-1)]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.toLowerCase())
  )
  const matches = candidates.filter((candidate) => names.has(skillPathBasename(candidate.path)))
  if (matches.length === 1) return matches[0].path
  if (suggested) return suggested
  return candidates.length === 1 ? candidates[0].path : null
}

async function scanMobileGitHubRepo(owner: string, repo: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`)
  if (!response.ok) throw new Error(`GitHub repository scan failed (HTTP ${response.status})`)
  const data = (await response.json()) as { tree?: Array<{ path: string; type: string }> }
  return (data.tree || [])
    .filter((entry) => entry.type === 'blob' && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')))
    .map((entry) => {
      const path = entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)
      return { name: path.split('/').pop() || repo, path }
    })
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
    const descriptor = await adapter.resolveDownload(slug, details.revision)
    const sizeBytes = descriptor.sizeBytes || (await probePersistentDownloadSize(descriptor.url))
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_MOBILE_SKILL_BYTES) {
      throw new Error('Skill package size is missing or exceeds the mobile limit')
    }
    const now = new Date().toISOString()
    const context: PendingSkillHubInstall = {
      schemaVersion: 1,
      taskId: await stableMobileSkillTaskId('skillhub', `${slug}\n${details.revision}`),
      state: 'prepared',
      sourceType: 'skillhub',
      skill: details,
      requireSignature: options.requireSignature === true,
      descriptor: {
        url: descriptor.url,
        sizeBytes,
        contentType: descriptor.contentType,
        sha256: descriptor.sha256,
        signature: descriptor.signature,
      },
      createdAt: now,
      updatedAt: now,
    }
    const persisted = await persistPendingSkillInstall(context, true)
    return await runPendingSkillInstall(persisted, { wait: true, userInitiated: true, verificationAdapter: adapter })
  } catch (error) {
    return { success: false, skillName: skill.name, error: error instanceof Error ? error.message : String(error) }
  }
}

function skillInstallName(context: PendingSkillInstall): string {
  return context.sourceType === 'skillhub'
    ? context.skill.name
    : context.skillPath.split('/').at(-1) || context.repo.toLowerCase()
}

function genericSkillDownloadRequest(context: PendingSkillInstall): GenericDownloadRequest {
  return {
    id: context.taskId,
    kind: 'skill',
    title: `Skill: ${skillInstallName(context)}`,
    url: context.descriptor.url,
    expectedSize: context.descriptor.sizeBytes,
    expectedSha256: context.descriptor.sha256,
  }
}

async function installGitHubSkillBytes(context: PendingGitHubSkillInstall, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength !== context.descriptor.sizeBytes) throw new Error('GitHub Skill size mismatch')
  const parsed = parseMobileSkill(new TextDecoder().decode(bytes), skillInstallName(context))
  if (!parsed) throw new Error('Invalid SKILL.md')
  const installedAt = new Date().toISOString()
  const contentHash = await sha256Hex(bytes)
  const source: SkillSource = {
    type: 'github',
    repo: `${context.owner}/${context.repo}`,
    commitHash: context.revision,
    revision: context.revision,
    skillPath: context.skillPath,
    installedAt,
  }
  const installRecord: SkillInstallRecord = {
    id: `github:${context.owner}/${context.repo}:${context.skillPath || '.'}`,
    slug: parsed.metadata.name,
    name: parsed.metadata.name,
    revision: context.revision,
    source,
    files: [{ path: 'SKILL.md', size: bytes.byteLength, sha256: contentHash }],
    contentHash,
    signatureVerified: false,
    executionMode: 'declarative',
    enabled: true,
    installedAt,
    updatedAt: installedAt,
  }
  await mutateMobileSkills((current) => [
    ...current.filter((skill) => skill.metadata.name !== parsed.metadata.name),
    {
      ...parsed,
      repo: `${context.owner}/${context.repo}`,
      skillPath: context.skillPath,
      installedAt,
      executionMode: 'declarative',
      source,
      installRecord,
    },
  ])
  return parsed.metadata.name
}

async function installSkillHubBytes(
  context: PendingSkillHubInstall,
  bytes: Uint8Array,
  adapter: SkillHubAdapter
): Promise<string> {
  const slug = context.skill.slug || context.skill.skillId
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const download = {
    slug,
    revision: context.skill.revision,
    bytes: arrayBuffer,
    contentType: context.descriptor.contentType,
    sha256: context.descriptor.sha256,
    signature: context.descriptor.signature,
  }
  const integrity = await adapter.verifyDownload(download, context.skill)
  if (context.requireSignature && !integrity.signatureVerified) throw new Error('SkillHub signature is required')
  const scriptsRequested = context.skill.capabilityManifest?.scripts === true
  const decoded = await decodeSkillHubPackage(download, scriptsRequested)
  if (scriptsRequested && Object.keys(decoded.scriptFiles).length === 0) {
    throw new Error('Script Skill packages must be ZIP archives with a validated executable manifest')
  }
  const entrypoints = Object.values(decoded.scriptFiles).map((script) => script.entrypoint)
  const declaredCapabilities = context.skill.capabilityManifest || {}
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
    repo: context.skill.source,
    slug,
    version: context.skill.version,
    revision: context.skill.revision,
    filesHash: integrity.sha256,
    signature: context.skill.signature,
    publisher: context.skill.publisher,
    capabilityManifest: {
      ...context.skill.capabilityManifest,
      scripts: scriptsRequested,
      scriptEntrypoints: entrypoints.length ? entrypoints : undefined,
    },
    installedAt: now,
  }
  const installRecord: SkillInstallRecord = {
    id: `skillhub:${slug}`,
    slug,
    name: parsed.metadata.name,
    version: context.skill.version,
    revision: context.skill.revision,
    source,
    files: decoded.files,
    contentHash: integrity.sha256 || (await sha256Hex(arrayBuffer)),
    signatureVerified: integrity.signatureVerified,
    executionMode: scriptsRequested ? 'script-disabled' : 'declarative',
    enabled: true,
    installedAt: now,
    updatedAt: now,
  }
  await mutateMobileSkills((current) => [
    ...current.filter((entry) => entry.metadata.name !== parsed.metadata.name),
    {
      ...parsed,
      installedAt: now,
      source,
      installRecord,
      executionMode: scriptsRequested ? 'script-disabled' : 'declarative',
      scriptFiles: decoded.scriptFiles,
      grantedScriptCapabilities: [],
    },
  ])
  return parsed.metadata.name
}

const pendingInstallRuns = new Map<string, Promise<SkillInstallResult>>()

async function runPendingSkillInstall(
  context: PendingSkillInstall,
  options: { wait: boolean; userInitiated: boolean; verificationAdapter?: SkillHubAdapter }
): Promise<SkillInstallResult> {
  const existing = pendingInstallRuns.get(context.taskId)
  if (existing) return existing
  const operation = runPendingSkillInstallOnce(context, options).finally(() => pendingInstallRuns.delete(context.taskId))
  pendingInstallRuns.set(context.taskId, operation)
  return operation
}

async function runPendingSkillInstallOnce(
  context: PendingSkillInstall,
  options: { wait: boolean; userInitiated: boolean; verificationAdapter?: SkillHubAdapter }
): Promise<SkillInstallResult> {
  const fallbackName = skillInstallName(context)
  if (context.state === 'installed') {
    try {
      await yachiyoDownloadsNative.removeArtifact({ id: context.taskId, keepRecord: true })
      await removePendingSkillInstall(context.taskId)
    } catch (error) {
      await updatePendingSkillInstall(context.taskId, {
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      })
    }
    return { success: true, skillName: fallbackName }
  }

  let task = (await yachiyoDownloadsNative.list()).tasks.find((candidate) => candidate.id === context.taskId)
  if (!task) {
    if (context.state === 'prepared' || options.userInitiated) {
      await yachiyoDownloadsNative.enqueue(genericSkillDownloadRequest(context))
      await updatePendingSkillInstall(context.taskId, { state: 'enqueued', lastError: undefined, updatedAt: new Date().toISOString() })
      context = { ...context, state: 'enqueued' }
    } else {
      // An enqueued task disappearing means the user removed it from Download management.
      await removePendingSkillInstall(context.taskId)
      return { success: false, skillName: fallbackName, error: 'Skill download was removed' }
    }
  } else if (task.status === 'cancelled') {
    if (!options.userInitiated) {
      await removePendingSkillInstall(context.taskId)
      return { success: false, skillName: fallbackName, error: 'Skill download cancelled' }
    }
    await yachiyoDownloadsNative.enqueue(genericSkillDownloadRequest(context))
    context = await persistPendingSkillInstall({
      ...context,
      state: 'enqueued',
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    })
  } else if (task.status === 'failed' && options.userInitiated) {
    await yachiyoDownloadsNative.resume({ id: context.taskId })
  }

  if (!options.wait) {
    task = (await yachiyoDownloadsNative.list()).tasks.find((candidate) => candidate.id === context.taskId)
    if (task?.status === 'failed' || task?.status === 'cancelled' || task?.status === 'paused') {
      return { success: false, skillName: fallbackName, error: task.error || `Skill download ${task.status}` }
    }
    if (task?.status !== 'completed') return { success: false, skillName: fallbackName, error: 'Skill install pending' }
  } else {
    const deadline = Date.now() + 30 * 60 * 1000
    while (Date.now() < deadline) {
      task = (await yachiyoDownloadsNative.list()).tasks.find((candidate) => candidate.id === context.taskId)
      if (task?.status === 'completed') break
      if (task?.status === 'failed' || task?.status === 'cancelled') {
        throw new Error(task.error || `Skill download ${task.status}`)
      }
      if (task?.status === 'paused') throw new Error('Skill download paused; resume it from Download management')
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (task?.status !== 'completed') throw new Error('Skill download timed out')
  }

  try {
    const bytes = await readCompletedDownload(context.taskId)
    if (bytes.byteLength !== context.descriptor.sizeBytes) throw new Error('Skill package size mismatch')
    const installedName =
      context.sourceType === 'github'
        ? await installGitHubSkillBytes(context, bytes)
        : await installSkillHubBytes(context, bytes, options.verificationAdapter || new SkillHubAdapter())
    await updatePendingSkillInstall(context.taskId, { state: 'installed', lastError: undefined, updatedAt: new Date().toISOString() })
    try {
      await yachiyoDownloadsNative.removeArtifact({ id: context.taskId, keepRecord: true })
      await removePendingSkillInstall(context.taskId)
    } catch (cleanupError) {
      await updatePendingSkillInstall(context.taskId, {
        lastError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        updatedAt: new Date().toISOString(),
      })
    }
    return { success: true, skillName: installedName }
  } catch (error) {
    await updatePendingSkillInstall(context.taskId, {
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    })
    throw error
  }
}

let pendingInstallMonitor: number | undefined

function schedulePendingSkillInstallResume(): void {
  if (typeof window === 'undefined' || pendingInstallMonitor !== undefined) return
  pendingInstallMonitor = window.setTimeout(() => {
    pendingInstallMonitor = undefined
    void resumePendingMobileSkillInstalls()
  }, 2_000)
}

/** Reclaims completed native Skill downloads after a WebView/app-process restart. */
export async function resumePendingMobileSkillInstalls(): Promise<void> {
  const pending = await readPendingSkillInstalls()
  let hasActiveDownload = false
  for (const context of pending) {
    const result = await runPendingSkillInstall(context, { wait: false, userInitiated: false }).catch(() => undefined)
    if (result?.error === 'Skill install pending') hasActiveDownload = true
  }
  if (hasActiveDownload) schedulePendingSkillInstallResume()
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
      await resumePendingMobileSkillInstalls()
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

  async installMarketplaceSkill(skill: MarketplaceSkill): Promise<SkillInstallResult> {
    if (platform.type === 'mobile') {
      if (isSkillHubSkill(skill)) return installMobileSkillHubSkill(skill)
      const location = parseMarketplaceGitHubLocation(skill.source)
      if (!location) {
        return { success: false, skillName: skill.name, error: '此 Skill 来源未提供可安装的 GitHub 仓库。' }
      }
      try {
        const candidates = await scanMobileGitHubRepo(location.owner, location.repo)
        const skillPath = selectMarketplaceSkillPath(skill, location, candidates)
        if (skillPath === null) {
          return { success: false, skillName: skill.name, error: '仓库中有多个 Skill，无法确定要安装的目录。' }
        }
        return installMobileGitHubSkill(location.owner, location.repo, skillPath)
      } catch (error) {
        return { success: false, skillName: skill.name, error: error instanceof Error ? error.message : String(error) }
      }
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
      return scanMobileGitHubRepo(owner, repo)
    }
    return window.electronAPI.invoke('skills:scan-repo', owner, repo)
  },

  checkForUpdate(name: string): Promise<SkillUpdateResult> {
    if (platform.type === 'mobile') return checkMobileSkillUpdate(name)
    return window.electronAPI.invoke('skills:check-update', name)
  },

  async checkForUpdatesBatch(): Promise<Record<string, { hasUpdate: boolean; error?: string }>> {
    if (platform.type === 'mobile') {
      const result: Record<string, { hasUpdate: boolean; error?: string }> = {}
      for (const skill of await readMobileSkills()) result[skill.metadata.name] = await checkMobileSkillUpdate(skill.metadata.name)
      return result
    }
    return window.electronAPI.invoke('skills:check-updates-batch')
  },
}
