export type Live2DRenderQuality = 'performance' | 'balanced' | 'high'

const STORAGE_KEY = 'yachiyo.live2d.render-quality.v1'
export const DEFAULT_LIVE2D_RENDER_QUALITY: Live2DRenderQuality = 'high'

export function getLive2DRenderQuality(): Live2DRenderQuality {
  if (typeof localStorage === 'undefined') return DEFAULT_LIVE2D_RENDER_QUALITY
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'performance' || value === 'balanced' || value === 'high'
    ? value
    : DEFAULT_LIVE2D_RENDER_QUALITY
}

export function setLive2DRenderQuality(quality: Live2DRenderQuality): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, quality)
}

export function getLive2DResolution(quality: Live2DRenderQuality, devicePixelRatio = 1): number {
  const cap = quality === 'performance' ? 1 : quality === 'balanced' ? 1.75 : 2.5
  return Math.max(1, Math.min(devicePixelRatio || 1, cap))
}
