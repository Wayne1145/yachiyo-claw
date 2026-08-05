export interface Live2DTransform {
  offsetX: number
  offsetY: number
  scale: number
}

export const DEFAULT_LIVE2D_TRANSFORM: Live2DTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
}

const STORAGE_PREFIX = 'yachiyo.interactive.live2d-transform.'

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeLive2DTransform(value?: Partial<Live2DTransform> | null): Live2DTransform {
  return {
    offsetX: Math.min(1.5, Math.max(-1.5, finiteOr(value?.offsetX, 0))),
    offsetY: Math.min(1.5, Math.max(-1.5, finiteOr(value?.offsetY, 0))),
    scale: Math.min(4, Math.max(0.25, finiteOr(value?.scale, 1))),
  }
}

export function loadLive2DTransform(modelId: string): Live2DTransform {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${modelId}`)
    return stored
      ? normalizeLive2DTransform(JSON.parse(stored) as Partial<Live2DTransform>)
      : { ...DEFAULT_LIVE2D_TRANSFORM }
  } catch {
    return { ...DEFAULT_LIVE2D_TRANSFORM }
  }
}

export function saveLive2DTransform(modelId: string, transform: Live2DTransform): Live2DTransform {
  const normalized = normalizeLive2DTransform(transform)
  localStorage.setItem(`${STORAGE_PREFIX}${modelId}`, JSON.stringify(normalized))
  return normalized
}

export function clearLive2DTransform(modelId: string): Live2DTransform {
  localStorage.removeItem(`${STORAGE_PREFIX}${modelId}`)
  return { ...DEFAULT_LIVE2D_TRANSFORM }
}
