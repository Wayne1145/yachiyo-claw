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
