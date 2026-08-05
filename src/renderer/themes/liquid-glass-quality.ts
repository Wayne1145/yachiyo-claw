import type { LiquidGlassQuality } from '@shared/types/settings'
import { getLogger } from '@/lib/utils'

const log = getLogger('flow-glass-quality')
let lastLoggedDecision: string | undefined

export type ResolvedLiquidGlassQuality = Exclude<LiquidGlassQuality, 'auto'>

export interface LiquidGlassCapabilities {
  supportsBackdropFilter: boolean
  supportsSvgDisplacement: boolean
  prefersReducedMotion: boolean
  prefersReducedTransparency: boolean
  prefersHighContrast: boolean
  forcedColors: boolean
  saveData: boolean
  androidMajorVersion?: number
  deviceMemoryGb?: number
  hardwareConcurrency?: number
}

export const LIQUID_GLASS_QUALITY_STORAGE_KEY = 'yachiyo:appearance:liquid-glass-quality:v1'
export const LIQUID_GLASS_RESOLVED_QUALITY_STORAGE_KEY = 'yachiyo:appearance:liquid-glass-resolved-quality:v1'

export type LiquidGlassFallbackReason =
  | 'none'
  | 'missing-backdrop-filter'
  | 'missing-svg-displacement'
  | 'reduced-transparency'
  | 'high-contrast'
  | 'forced-colors'
  | 'save-data'
  | 'reduced-motion'
  | 'android-version'
  | 'hardware-concurrency'
  | 'device-memory'
  | 'unknown-hardware'

export interface LiquidGlassQualityDecision {
  quality: ResolvedLiquidGlassQuality
  reason: LiquidGlassFallbackReason
}

export function resolveLiquidGlassQuality(
  preference: LiquidGlassQuality,
  capabilities: LiquidGlassCapabilities
): ResolvedLiquidGlassQuality {
  return resolveLiquidGlassQualityDecision(preference, capabilities).quality
}

export function resolveLiquidGlassQualityDecision(
  preference: LiquidGlassQuality,
  capabilities: LiquidGlassCapabilities
): LiquidGlassQualityDecision {
  if (!capabilities.supportsBackdropFilter) return { quality: 'reduced', reason: 'missing-backdrop-filter' }
  if (capabilities.prefersReducedTransparency) return { quality: 'reduced', reason: 'reduced-transparency' }
  if (capabilities.forcedColors) return { quality: 'reduced', reason: 'forced-colors' }
  if (capabilities.prefersHighContrast) return { quality: 'reduced', reason: 'high-contrast' }
  if (preference === 'reduced') return { quality: 'reduced', reason: 'none' }
  if (preference === 'balanced') return { quality: 'balanced', reason: 'none' }
  if (preference === 'full') {
    return capabilities.supportsSvgDisplacement
      ? { quality: 'full', reason: 'none' }
      : { quality: 'balanced', reason: 'missing-svg-displacement' }
  }

  if (capabilities.saveData) return { quality: 'reduced', reason: 'save-data' }
  if (capabilities.deviceMemoryGb !== undefined && capabilities.deviceMemoryGb <= 2)
    return { quality: 'reduced', reason: 'device-memory' }
  if (capabilities.hardwareConcurrency !== undefined && capabilities.hardwareConcurrency < 4)
    return { quality: 'reduced', reason: 'hardware-concurrency' }
  if (capabilities.prefersReducedMotion) return { quality: 'balanced', reason: 'reduced-motion' }
  if (!capabilities.supportsSvgDisplacement) return { quality: 'balanced', reason: 'missing-svg-displacement' }
  // Android WebViews can advertise SVG backdrop filters while rendering them inconsistently.
  // Auto stays on the stable blur path; Full remains available as an explicit choice.
  if (capabilities.androidMajorVersion !== undefined) return { quality: 'balanced', reason: 'android-version' }
  if (capabilities.hardwareConcurrency === undefined || capabilities.deviceMemoryGb === undefined)
    return { quality: 'balanced', reason: 'unknown-hardware' }
  if (capabilities.hardwareConcurrency < 6) return { quality: 'balanced', reason: 'hardware-concurrency' }
  if (capabilities.deviceMemoryGb < 4) return { quality: 'balanced', reason: 'device-memory' }

  return { quality: 'full', reason: 'none' }
}

type NavigatorWithPerformanceHints = Navigator & {
  deviceMemory?: number
  connection?: {
    saveData?: boolean
    addEventListener?: (type: 'change', listener: () => void) => void
    removeEventListener?: (type: 'change', listener: () => void) => void
  }
}

const LIQUID_GLASS_CAPABILITY_MEDIA_QUERIES = [
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(prefers-contrast: more)',
  '(forced-colors: active)',
] as const

function mediaMatches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

export function detectLiquidGlassCapabilities(): LiquidGlassCapabilities {
  const runtimeNavigator = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithPerformanceHints)
  const supportsBackdropFilter =
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'))
  const displacementElement =
    typeof document === 'undefined'
      ? undefined
      : document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap')
  const supportsSvgDisplacement =
    supportsBackdropFilter &&
    typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'url("#yachiyo-flow-capability-test") blur(1px)') ||
      CSS.supports('-webkit-backdrop-filter', 'url("#yachiyo-flow-capability-test") blur(1px)')) &&
    Boolean(displacementElement && 'scale' in displacementElement)
  const androidMatch = runtimeNavigator?.userAgent.match(/Android\s+(\d+)/i)

  return {
    supportsBackdropFilter,
    supportsSvgDisplacement,
    prefersReducedMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
    prefersReducedTransparency: mediaMatches('(prefers-reduced-transparency: reduce)'),
    prefersHighContrast: mediaMatches('(prefers-contrast: more)'),
    forcedColors: mediaMatches('(forced-colors: active)'),
    saveData: runtimeNavigator?.connection?.saveData === true,
    androidMajorVersion: androidMatch?.[1] ? Number.parseInt(androidMatch[1], 10) : undefined,
    deviceMemoryGb: runtimeNavigator?.deviceMemory,
    hardwareConcurrency: runtimeNavigator?.hardwareConcurrency,
  }
}

export function applyLiquidGlassQuality(
  preference: LiquidGlassQuality,
  capabilities = detectLiquidGlassCapabilities()
): ResolvedLiquidGlassQuality {
  const decision = resolveLiquidGlassQualityDecision(preference, capabilities)
  const resolved = decision.quality
  const decisionKey = `${resolved}:${decision.reason}`

  if (decisionKey !== lastLoggedDecision) {
    lastLoggedDecision = decisionKey
    log.info(`quality=${resolved} fallback=${decision.reason}`)
  }

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.yachiyoLiquidGlassQualityPreference = preference
    document.documentElement.dataset.yachiyoLiquidGlassQuality = resolved
    document.documentElement.dataset.yachiyoLiquidGlassFallback = decision.reason
  }

  try {
    localStorage.setItem(LIQUID_GLASS_QUALITY_STORAGE_KEY, preference)
    localStorage.setItem(LIQUID_GLASS_RESOLVED_QUALITY_STORAGE_KEY, resolved)
  } catch {
    // The attributes still apply for this session when the early-paint mirror is unavailable.
  }

  return resolved
}

export function observeLiquidGlassQuality(preference: LiquidGlassQuality): () => void {
  const update = () => applyLiquidGlassQuality(preference)
  update()

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined

  const mediaQueries = LIQUID_GLASS_CAPABILITY_MEDIA_QUERIES.map((query) => window.matchMedia(query))
  for (const mediaQuery of mediaQueries) {
    if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', update)
    else mediaQuery.addListener?.(update)
  }

  const runtimeNavigator = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithPerformanceHints)
  runtimeNavigator?.connection?.addEventListener?.('change', update)

  return () => {
    for (const mediaQuery of mediaQueries) {
      if (typeof mediaQuery.removeEventListener === 'function') mediaQuery.removeEventListener('change', update)
      else mediaQuery.removeListener?.(update)
    }
    runtimeNavigator?.connection?.removeEventListener?.('change', update)
  }
}
