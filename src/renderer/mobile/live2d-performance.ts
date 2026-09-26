export type Live2DRenderQuality = 'performance' | 'balanced' | 'high'

const STORAGE_KEY = 'yachiyo.live2d.render-quality.v1'
export const DEFAULT_LIVE2D_RENDER_QUALITY: Live2DRenderQuality = 'high'

export interface Live2DResolutionConstraints {
  width?: number
  height?: number
  maxRenderbufferSize?: number
  isAndroid?: boolean
}

export function getLive2DRenderQuality(): Live2DRenderQuality {
  if (typeof localStorage === 'undefined') return DEFAULT_LIVE2D_RENDER_QUALITY
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'performance' || value === 'balanced' || value === 'high' ? value : DEFAULT_LIVE2D_RENDER_QUALITY
  } catch {
    return DEFAULT_LIVE2D_RENDER_QUALITY
  }
}

export function setLive2DRenderQuality(quality: Live2DRenderQuality): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, quality)
  } catch {
    // Some WebViews can temporarily deny storage access while the app is starting.
  }
}

export function getLive2DResolution(
  quality: Live2DRenderQuality,
  devicePixelRatio = 1,
  constraints: Live2DResolutionConstraints = {}
): number {
  const cap = quality === 'performance' ? 1 : quality === 'balanced' ? 1.75 : 2.5
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const platformCap = constraints.isAndroid ? 1.5 : Number.POSITIVE_INFINITY
  const maxRenderbufferSize =
    typeof constraints.maxRenderbufferSize === 'number' &&
    Number.isFinite(constraints.maxRenderbufferSize) &&
    constraints.maxRenderbufferSize > 0
      ? constraints.maxRenderbufferSize
      : undefined
  const dimensions = [constraints.width, constraints.height].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
  )
  const viewportCap =
    maxRenderbufferSize && dimensions.length
      ? Math.min(...dimensions.map((value) => maxRenderbufferSize / value))
      : Number.POSITIVE_INFINITY

  // A sub-1 resolution is preferable to asking WebGL for an oversized drawing buffer.
  return Math.max(0.5, Math.min(dpr, cap, platformCap, viewportCap))
}

const LIVE2D_URL_PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:/i

/** Resolve bundled assets without breaking Electron's file renderer or Capacitor. */
export function resolveLive2DAssetUrl(source: string, baseUrl?: string): string {
  if (LIVE2D_URL_PROTOCOL_PATTERN.test(source)) return source
  const base = baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : '')
  if (!base) return source
  try {
    return new URL(source.replace(/^\/+/, ''), base).toString()
  } catch {
    return source
  }
}

/** Cubism editor release that writes each .moc3 format version. */
const MOC_FORMAT_RELEASES: Record<number, string> = { 1: '3.0', 2: '3.3', 3: '4.0', 4: '4.2', 5: '5.0', 6: '5.3' }

export function describeLive2DMocFormat(version: number): string {
  return MOC_FORMAT_RELEASES[version] ? `Cubism ${MOC_FORMAT_RELEASES[version]}` : `MOC ${version}`
}

/** Reads the .moc3 format version from its header without asking Cubism Core to parse it. */
export function readLive2DMocFormat(bytes: ArrayBuffer | Uint8Array): number | undefined {
  const header = bytes instanceof Uint8Array ? bytes.subarray(0, 8) : new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8))
  if (header.length < 5 || header[0] !== 0x4d || header[1] !== 0x4f || header[2] !== 0x43 || header[3] !== 0x33) {
    return undefined
  }
  return header[4] || undefined
}

/**
 * Explains a failed model load. Only the first chunk of the .moc3 is read, so a
 * diagnosis never costs a second full download of a multi-megabyte model.
 */
export async function probeLive2DMocFormat(modelSettingsUrl: string): Promise<number | undefined> {
  const modelResponse = await fetch(modelSettingsUrl)
  if (!modelResponse.ok) return undefined
  const model = (await modelResponse.json()) as { FileReferences?: { Moc?: string } }
  const moc = model.FileReferences?.Moc
  if (!moc) return undefined
  const mocResponse = await fetch(new URL(moc, modelSettingsUrl).toString())
  if (!mocResponse.ok || !mocResponse.body) return undefined
  const reader = mocResponse.body.getReader()
  try {
    const { value } = await reader.read()
    return value ? readLive2DMocFormat(value) : undefined
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}
