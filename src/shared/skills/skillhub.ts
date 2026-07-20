import { MarketplaceSkillSchema, type MarketplaceSkill, type SkillSignature } from '../types/skills'

export const SKILLHUB_API_BASE_URL = 'https://api.skillhub.cn'
const MAX_ARCHIVE_FILES = 512
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const SCRIPT_EXTENSIONS = new Set(['.bat', '.cjs', '.cmd', '.com', '.exe', '.js', '.mjs', '.ps1', '.py', '.sh', '.ts'])

export type SkillHubDownload = {
  slug: string
  revision?: string
  bytes: ArrayBuffer
  contentType?: string
  sha256?: string
  signature?: SkillSignature
}

export type SkillArchiveEntry = {
  path: string
  size: number
  type?: 'file' | 'directory' | 'symlink'
}

export class SkillHubError extends Error {
  constructor(
    message: string,
    public readonly code: 'disabled' | 'http' | 'invalid_response' | 'integrity' | 'signature' | 'archive',
    public readonly status?: number
  ) {
    super(message)
    this.name = 'SkillHubError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function unwrap(value: unknown): unknown {
  const item = record(value)
  return item?.data ?? value
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const item = record(value)
  if (!item) return []
  for (const key of ['items', 'skills', 'results', 'data']) {
    if (Array.isArray(item[key])) return item[key] as unknown[]
    const nested = list(item[key])
    if (nested.length) return nested
  }
  return []
}

function normalizeHash(value: unknown): string | undefined {
  const hash = stringValue(value)?.replace(/^sha256:/i, '').toLowerCase()
  return hash && /^[a-f0-9]{64}$/.test(hash) ? hash : undefined
}

function normalizeSlug(value: unknown): string {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 128)
  if (!slug) throw new SkillHubError('SkillHub response did not include a valid slug.', 'invalid_response')
  return slug
}

function normalizeSignature(value: unknown): SkillSignature | undefined {
  if (typeof value === 'string' && value.trim()) return { algorithm: 'ed25519', value: value.trim() }
  const item = record(value)
  const signature = stringValue(item?.value ?? item?.signature)
  if (!signature || String(item?.algorithm || 'ed25519').toLowerCase() !== 'ed25519') return undefined
  return {
    algorithm: 'ed25519',
    value: signature,
    keyId: stringValue(item?.keyId ?? item?.key_id),
    publicKey: stringValue(item?.publicKey ?? item?.public_key),
  }
}

function normalizeSkill(value: unknown, fallback?: string): MarketplaceSkill {
  const item = record(value)
  if (!item) throw new SkillHubError('SkillHub returned malformed skill metadata.', 'invalid_response')
  const slug = normalizeSlug(item.slug ?? item.skillId ?? item.skill_id ?? item.id ?? fallback)
  const sourceObject = record(item.source)
  const source = stringValue(sourceObject?.url ?? sourceObject?.href ?? item.source) || `https://skillhub.cn/skills/${slug}`
  const capabilities = record(item.capabilityManifest ?? item.capabilities)
  return MarketplaceSkillSchema.parse({
    id: stringValue(item.id) || slug,
    skillId: slug,
    name: stringValue(item.name ?? item.title) || slug,
    installs: Math.max(0, Math.floor(Number(item.installs ?? item.installCount ?? item.downloads) || 0)),
    source,
    description: stringValue(item.description ?? item.summary),
    slug,
    version: stringValue(item.version),
    revision: stringValue(item.revision ?? item.commit ?? item.commitHash ?? item.commit_hash),
    filesHash: normalizeHash(item.filesHash ?? item.files_hash ?? item.sha256),
    signature: normalizeSignature(item.signature),
    publisher: stringValue(item.publisher ?? record(item.author)?.name ?? item.author),
    requiresApiKeys: Array.isArray(item.requiresApiKeys ?? item.requires_api_keys)
      ? (item.requiresApiKeys ?? item.requires_api_keys)
      : undefined,
    capabilityManifest: capabilities
      ? {
          network: typeof capabilities.network === 'boolean' ? capabilities.network : undefined,
          filesystem: typeof capabilities.filesystem === 'boolean' ? capabilities.filesystem : undefined,
          scripts: typeof capabilities.scripts === 'boolean' ? capabilities.scripts : undefined,
          privileged: typeof capabilities.privileged === 'boolean' ? capabilities.privileged : undefined,
          tools: Array.isArray(capabilities.tools) ? capabilities.tools.filter((tool) => typeof tool === 'string') : undefined,
        }
      : undefined,
  })
}

function safeArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !url.username && !url.password && host !== 'localhost' && !host.endsWith('.local')
  } catch {
    return false
  }
}

export class SkillHubAdapter {
  private readonly baseUrl: string
  private readonly enabled: boolean
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: { baseUrl?: string; enabled?: boolean; fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.baseUrl = (options.baseUrl || SKILLHUB_API_BASE_URL).replace(/\/+$/, '')
    this.enabled = options.enabled ?? true
    this.fetchImpl = options.fetch || fetch
    this.timeoutMs = Math.max(1_000, options.timeoutMs || 15_000)
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.enabled) throw new SkillHubError('SkillHub integration is disabled.', 'disabled')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(/^https:\/\//.test(path) ? path : `${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async search(query: { query?: string; page?: number; pageSize?: number; revision?: string } = {}) {
    const url = new URL(`${this.baseUrl}/v1/skills`)
    if (query.query) url.searchParams.set('q', query.query)
    if (query.page) url.searchParams.set('page', String(query.page))
    if (query.pageSize) url.searchParams.set('page_size', String(query.pageSize))
    if (query.revision) url.searchParams.set('revision', query.revision)
    const response = await this.request(url.pathname + url.search)
    if (!response.ok) throw new SkillHubError(`SkillHub request failed with HTTP ${response.status}.`, 'http', response.status)
    const payload = unwrap(await response.json())
    const envelope = record(payload) || {}
    const items = list(payload).map((item) => normalizeSkill(item))
    return {
      items,
      page: Number(envelope.page) || query.page || 1,
      pageSize: Number(envelope.pageSize ?? envelope.page_size) || query.pageSize || items.length,
      total: envelope.total == null ? undefined : Number(envelope.total),
      nextCursor: stringValue(envelope.nextCursor ?? envelope.next_cursor),
    }
  }

  async getSkill(slug: string): Promise<MarketplaceSkill> {
    const normalized = normalizeSlug(slug)
    const response = await this.request(`/v1/skills/${encodeURIComponent(normalized)}`)
    if (!response.ok) throw new SkillHubError(`SkillHub request failed with HTTP ${response.status}.`, 'http', response.status)
    return normalizeSkill(unwrap(await response.json()), normalized)
  }

  async getSignature(slug: string, revision?: string): Promise<SkillSignature | undefined> {
    const suffix = revision ? `?revision=${encodeURIComponent(revision)}` : ''
    const response = await this.request(`/v1/skills/${encodeURIComponent(normalizeSlug(slug))}/signature${suffix}`)
    if (response.status === 404 || response.status === 405) return undefined
    if (!response.ok) throw new SkillHubError(`SkillHub request failed with HTTP ${response.status}.`, 'http', response.status)
    return normalizeSignature(unwrap(await response.json()))
  }

  async download(slug: string, revision?: string): Promise<SkillHubDownload> {
    const normalized = normalizeSlug(slug)
    const suffix = revision ? `?revision=${encodeURIComponent(revision)}` : ''
    let response = await this.request(`/v1/skills/${encodeURIComponent(normalized)}/download${suffix}`)
    let sha256 = normalizeHash(response.headers.get('x-skill-sha256'))
    let signature = normalizeSignature(response.headers.get('x-skill-signature'))
    if (response.headers.get('content-type')?.includes('application/json')) {
      const metadata = record(unwrap(await response.json()))
      const url = stringValue(metadata?.downloadUrl ?? metadata?.download_url ?? metadata?.url)
      if (!url || !safeArtifactUrl(url)) throw new SkillHubError('SkillHub download URL must use public HTTPS.', 'invalid_response')
      sha256 = normalizeHash(metadata?.sha256 ?? metadata?.filesHash) || sha256
      signature = normalizeSignature(metadata?.signature) || signature
      response = await this.request(url)
    }
    if (!response.ok) throw new SkillHubError(`SkillHub download failed with HTTP ${response.status}.`, 'http', response.status)
    return {
      slug: normalized,
      revision,
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') || undefined,
      sha256,
      signature,
    }
  }

  async verifyDownload(download: SkillHubDownload, expected?: MarketplaceSkill) {
    const sha256 = await sha256Hex(download.bytes)
    const expectedHash = normalizeHash(expected?.filesHash ?? download.sha256)
    if (expectedHash && sha256 !== expectedHash) throw new SkillHubError('SkillHub download hash mismatch.', 'integrity')
    const signature = expected?.signature || download.signature
    if (!signature) return { sha256, signatureVerified: false }
    if (!signature.publicKey || !(await verifyEd25519Signature(download.bytes, signature.value, signature.publicKey))) {
      throw new SkillHubError('SkillHub signature verification failed.', 'signature')
    }
    return { sha256, signatureVerified: true }
  }
}

export function inspectSkillArchive(
  entries: SkillArchiveEntry[],
  policy: { maxFiles?: number; maxTotalBytes?: number } = {}
) {
  if (entries.length > (policy.maxFiles ?? MAX_ARCHIVE_FILES)) throw new SkillHubError('Skill archive has too many files.', 'archive')
  const seen = new Set<string>()
  let totalBytes = 0
  let hasSkillMd = false
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/')
    const segments = path.split('/')
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : ''
    if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || segments.includes('..') || entry.type === 'symlink' || seen.has(path)) {
      throw new SkillHubError(`Unsafe path in Skill archive: ${entry.path}`, 'archive')
    }
    if (!Number.isFinite(entry.size) || entry.size < 0) throw new SkillHubError('Invalid Skill archive size.', 'archive')
    if (segments.includes('scripts') || SCRIPT_EXTENSIONS.has(extension)) {
      throw new SkillHubError('Executable Skill files are disabled on mobile.', 'archive')
    }
    seen.add(path)
    totalBytes += entry.size
    if (totalBytes > (policy.maxTotalBytes ?? MAX_ARCHIVE_BYTES)) throw new SkillHubError('Skill archive exceeds size limit.', 'archive')
    if (segments.at(-1)?.toLowerCase() === 'skill.md') hasSkillMd = true
  }
  if (!hasSkillMd) throw new SkillHubError('Skill archive must contain SKILL.md.', 'archive')
  return { files: entries, totalBytes, hasSkillMd, containsScripts: false, warnings: [] as string[] }
}

function decode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function ownedBuffer(value: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer
  if (value instanceof Uint8Array) return Uint8Array.from(value).buffer
  return value.slice(0)
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyEd25519Signature(
  value: string | ArrayBuffer | Uint8Array,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', decode(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, decode(signature), ownedBuffer(value))
  } catch {
    return false
  }
}
