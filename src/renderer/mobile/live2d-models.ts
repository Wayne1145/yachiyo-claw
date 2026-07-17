import JSZip from 'jszip'
import localforage from 'localforage'

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
    Expressions?: Array<{ Name?: string; File?: string }>
    Motions?: Record<string, Array<{ File?: string }>>
  }
}

const REGISTRY_KEY = 'yachiyo.live2d.models.v1'
const SELECTED_KEY = 'yachiyo.live2d.selected.v1'
const ONBOARDING_KEY = 'yachiyo.live2d.onboarded.v1'
const modelStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'live2d-models' })
const objectUrls = new Map<string, string>()

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
    (path) => !path.toLocaleLowerCase().endsWith('items_pinned_to_model.json') && path.endsWith('.model3.json')
  )
}

export async function importLive2DModel(file: File): Promise<Live2DModelDescriptor> {
  const zip = await JSZip.loadAsync(file)
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir)
  const settingsPath = findModelSettingsPath(paths)
  if (!settingsPath) throw new Error('ZIP 中没有找到 .model3.json')

  const settingsText = await zip.file(settingsPath)?.async('text')
  if (!settingsText) throw new Error('无法读取 Live2D 模型配置')
  const settings = JSON.parse(settingsText) as Model3Json
  const actions = extractLive2DActions(settings)
  const id = `live2d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = file.name.replace(/\.zip$/i, '') || '导入模型'
  const blobKey = `model:${id}`
  const blob = new Blob([await file.arrayBuffer()], { type: 'application/zip' })

  await modelStorage.setItem(blobKey, blob)
  const stored: StoredLive2DModel = { id, name, blobKey, actions, importedAt: Date.now() }
  writeStoredRegistry([...readStoredRegistry(), stored])
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
