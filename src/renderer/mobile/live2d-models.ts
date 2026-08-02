import JSZip from 'jszip'
import localforage from 'localforage'
import { createLive2DError, normalizeLive2DError } from './live2d-errors'

export type Live2DActionKind = 'expression' | 'motion'

export interface Live2DAction {
  token: string
  kind: Live2DActionKind
  expressionName?: string
  motionGroup?: string
  motionIndex?: number
}

export interface Live2DModelDescriptor {
  id: string
  name: string
  source: string
  avatar?: string
  builtIn: boolean
  actions: Live2DAction[]
}

interface StoredLive2DModel {
  id: string
  name: string
  blobKey: string
  actions: Live2DAction[]
  importedAt: number
}

interface Model3Json {
  FileReferences?: {
    Moc?: string
    Textures?: string[]
    Physics?: string
    DisplayInfo?: string
    Expressions?: Array<{ Name?: string; File?: string }>
    Motions?: Record<string, Array<{ File?: string }>>
  }
}

const REGISTRY_KEY = 'yachiyo.live2d.models.v1'
const SELECTED_KEY = 'yachiyo.live2d.selected.v1'
const ONBOARDING_KEY = 'yachiyo.live2d.onboarded.v1'
const modelStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'live2d-models' })
const objectUrls = new Map<string, string>()

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_FILES = 2_000
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024

export function validateLive2DArchiveLimits(fileSize: number, fileCount: number, uncompressedBytes: number): void {
  if (fileSize > MAX_ARCHIVE_BYTES) {
    throw createLive2DError('L2D-IMP-002', { technicalDetail: `archiveBytes=${fileSize}` })
  }
  if (fileCount > MAX_ARCHIVE_FILES) {
    throw createLive2DError('L2D-IMP-003', { technicalDetail: `fileCount=${fileCount}` })
  }
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw createLive2DError('L2D-IMP-004', { technicalDetail: `uncompressedBytes=${uncompressedBytes}` })
  }
}

export const BUILT_IN_LIVE2D_MODEL_ID = 'yachiyo-built-in'

export const BUILT_IN_YACHIYO_MODEL: Live2DModelDescriptor = {
  id: BUILT_IN_LIVE2D_MODEL_ID,
  name: '月见八千代',
  source: '/live2d/yachiyo/model.model3.json',
  avatar: '/live2d/yachiyo/avatar.png',
  builtIn: true,
  actions: [
    { token: 'zhongxin', kind: 'expression', expressionName: 'zhongxin' },
    { token: 'leizhu', kind: 'expression', expressionName: 'leizhu' },
    { token: 'mimiyan', kind: 'expression', expressionName: 'mimiyan' },
    { token: 'xiaomimi', kind: 'expression', expressionName: 'xiaomimi' },
    { token: 'yanlei', kind: 'expression', expressionName: 'yanlei' },
  ],
}

function readStoredRegistry(): StoredLive2DModel[] {
  try {
    const value = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeStoredRegistry(models: StoredLive2DModel[]) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(models))
  window.dispatchEvent(new Event('yachiyo-live2d-models-changed'))
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function withoutExtension(path: string): string {
  return basename(path).replace(/\.(motion3|exp3)\.json$/i, '')
}

export function extractLive2DActions(settings: Model3Json): Live2DAction[] {
  const refs = settings.FileReferences
  const actions: Live2DAction[] = []
  const usedTokens = new Set<string>()

  for (const expression of refs?.Expressions || []) {
    const name = expression.Name?.trim() || (expression.File ? withoutExtension(expression.File) : '')
    if (!name || usedTokens.has(name)) continue
    usedTokens.add(name)
    actions.push({ token: name, kind: 'expression', expressionName: name })
  }

  for (const [group, motions] of Object.entries(refs?.Motions || {})) {
    motions.forEach((motion, index) => {
      const fileName = motion.File ? withoutExtension(motion.File) : ''
      const candidates = motions.length === 1 ? [group, fileName] : [fileName, `${group}_${index + 1}`]
      const token = candidates.find((candidate) => candidate && !usedTokens.has(candidate))
      if (!token) return
      usedTokens.add(token)
      actions.push({ token, kind: 'motion', motionGroup: group, motionIndex: index })
    })
  }

  return actions
}

export function parseLive2DActionMarkers(text: string, actions: Live2DAction[]) {
  const actionMap = new Map(actions.map((action) => [action.token.toLocaleLowerCase(), action]))
  const events: Array<{ action: Live2DAction; index: number; marker: string }> = []
  const markerPattern = /\[([^\]\r\n]{1,80})\]/g
  let match: RegExpExecArray | null

  while ((match = markerPattern.exec(text))) {
    const action = actionMap.get(match[1].trim().toLocaleLowerCase())
    if (action) events.push({ action, index: match.index, marker: match[0] })
  }

  return events
}

export function hideValidLive2DMarkers(text: string, actions: Live2DAction[]): string {
  const valid = new Set(actions.map((action) => action.token.toLocaleLowerCase()))
  return text.replace(/\[([^\]\r\n]{1,80})\]/g, (marker, token: string) =>
    valid.has(token.trim().toLocaleLowerCase()) ? '' : marker
  )
}

export function buildLive2DActionPrompt(actions: Live2DAction[]): string {
  if (!actions.length) return ''
  const expressions = actions.filter((action) => action.kind === 'expression').map((action) => `[${action.token}]`)
  const motions = actions.filter((action) => action.kind === 'motion').map((action) => `[${action.token}]`)
  return [
    '你可以在回复中插入 Live2D 动作标记。标记会按朗读顺序执行，但仍会保留在聊天记录中。',
    expressions.length ? `可用表情：${expressions.join('、')}` : '',
    motions.length ? `可用动作：${motions.join('、')}` : '',
    '只使用上面列出的标记；可在一段回复中多次切换。',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function listLive2DModels(): Promise<Live2DModelDescriptor[]> {
  const imported = await Promise.all(
    readStoredRegistry().map(async (stored) => {
      const blob = await modelStorage.getItem<Blob>(stored.blobKey)
      if (!blob) return null
      let source = objectUrls.get(stored.id)
      if (!source) {
        source = URL.createObjectURL(blob)
        objectUrls.set(stored.id, source)
      }
      return {
        id: stored.id,
        name: stored.name,
        source: `zip://${source}`,
        builtIn: false,
        actions: stored.actions,
      } as Live2DModelDescriptor
    })
  )
  const available: Live2DModelDescriptor[] = [BUILT_IN_YACHIYO_MODEL]
  for (const model of imported) {
    if (model) available.push(model)
  }
  return available
}

function findModelSettingsPath(paths: string[]): string | undefined {
  return paths.find(
    (path) =>
      !path.toLocaleLowerCase().endsWith('items_pinned_to_model.json') &&
      path.toLocaleLowerCase().endsWith('.model3.json')
  )
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/')
  if (
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    segments.some((segment) => segment === '..')
  ) {
    throw createLive2DError('L2D-CFG-003', { resource: path, technicalDetail: `unsafePath=${path}` })
  }
  return segments.filter((segment) => segment && segment !== '.').join('/')
}

function resolveModelReference(settingsPath: string, reference: string): string {
  const base = settingsPath.split('/').slice(0, -1)
  return normalizeArchivePath([...base, reference].join('/'))
}

function validateModelReferences(settingsPath: string, settings: Model3Json, paths: string[]): void {
  const refs = settings.FileReferences
  if (!refs?.Moc || !Array.isArray(refs.Textures) || refs.Textures.length === 0) {
    throw createLive2DError('L2D-CFG-002', { resource: settingsPath, technicalDetail: 'Missing Moc or Textures' })
  }
  const normalizedPaths = new Map<string, string>()
  for (const path of paths) {
    const normalized = normalizeArchivePath(path)
    const comparisonKey = normalized.toLocaleLowerCase()
    if (normalizedPaths.has(comparisonKey)) {
      throw createLive2DError('L2D-CFG-003', {
        resource: path,
        technicalDetail: `Conflicting paths: ${normalizedPaths.get(comparisonKey)} and ${path}`,
      })
    }
    normalizedPaths.set(comparisonKey, normalized)
  }

  const referenced = [
    refs.Moc,
    ...refs.Textures,
    refs.Physics,
    refs.DisplayInfo,
    ...(refs.Expressions || []).map((expression) => expression.File),
    ...Object.values(refs.Motions || {}).flatMap((motions) => motions.map((motion) => motion.File)),
  ].filter((path): path is string => Boolean(path))

  for (const reference of referenced) {
    const resolved = resolveModelReference(settingsPath, reference)
    if (!normalizedPaths.has(resolved.toLocaleLowerCase())) {
      throw createLive2DError('L2D-CFG-004', {
        resource: resolved,
        technicalDetail: `Missing referenced asset: ${resolved}`,
      })
    }
  }
}

export async function importLive2DModel(file: File): Promise<Live2DModelDescriptor> {
  validateLive2DArchiveLimits(file.size, 0, 0)
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch (reason) {
    throw createLive2DError('L2D-IMP-001', { technicalDetail: normalizeLive2DError(reason, { phase: 'import' }).technicalDetail })
  }
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir)
  const uncompressedBytes = paths.reduce((total, path) => {
    const entry = zip.files[path] as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } }
    return total + Math.max(0, entry._data?.uncompressedSize ?? 0)
  }, 0)
  validateLive2DArchiveLimits(file.size, paths.length, uncompressedBytes)
  const settingsPath = findModelSettingsPath(paths)
  if (!settingsPath) throw createLive2DError('L2D-CFG-001')

  const settingsText = await zip.file(settingsPath)?.async('text')
  if (!settingsText) throw createLive2DError('L2D-CFG-002', { resource: settingsPath })
  let settings: Model3Json
  try {
    settings = JSON.parse(settingsText) as Model3Json
  } catch (reason) {
    throw createLive2DError('L2D-CFG-002', {
      resource: settingsPath,
      technicalDetail: normalizeLive2DError(reason, { phase: 'settings' }).technicalDetail,
    })
  }
  validateModelReferences(normalizeArchivePath(settingsPath), settings, paths)
  const actions = extractLive2DActions(settings)
  const id = `live2d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = file.name.replace(/\.zip$/i, '') || '导入模型'
  const blobKey = `model:${id}`
  const blob = new Blob([await file.arrayBuffer()], { type: 'application/zip' })

  try {
    await modelStorage.setItem(blobKey, blob)
  } catch (reason) {
    throw createLive2DError('L2D-STORE-001', {
      technicalDetail: normalizeLive2DError(reason, { phase: 'storage' }).technicalDetail,
    })
  }
  const stored: StoredLive2DModel = { id, name, blobKey, actions, importedAt: Date.now() }
  try {
    writeStoredRegistry([...readStoredRegistry(), stored])
  } catch (reason) {
    await modelStorage.removeItem(blobKey).catch(() => undefined)
    throw createLive2DError('L2D-STORE-001', {
      technicalDetail: normalizeLive2DError(reason, { phase: 'storage' }).technicalDetail,
    })
  }
  const source = URL.createObjectURL(blob)
  objectUrls.set(id, source)
  return { id, name, source: `zip://${source}`, builtIn: false, actions }
}

export async function deleteLive2DModel(id: string): Promise<void> {
  if (id === BUILT_IN_LIVE2D_MODEL_ID) return
  const models = readStoredRegistry()
  const target = models.find((model) => model.id === id)
  if (target) await modelStorage.removeItem(target.blobKey)
  const source = objectUrls.get(id)
  if (source) URL.revokeObjectURL(source)
  objectUrls.delete(id)
  writeStoredRegistry(models.filter((model) => model.id !== id))
  if (getSelectedLive2DModelId() === id) setSelectedLive2DModelId(BUILT_IN_LIVE2D_MODEL_ID)
}

export function getSelectedLive2DModelId(): string {
  return localStorage.getItem(SELECTED_KEY) || BUILT_IN_LIVE2D_MODEL_ID
}

export function setSelectedLive2DModelId(id: string) {
  localStorage.setItem(SELECTED_KEY, id)
}

export function hasCompletedLive2DOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true'
}

export function completeLive2DOnboarding() {
  localStorage.setItem(ONBOARDING_KEY, 'true')
}
