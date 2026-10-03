export interface CubismCoreSupport {
  /** Raw csmGetVersion value, e.g. 0x6000001 for Core 6.0.1. */
  coreVersion?: number
  /** csmGetLatestMocVersion enum: 3=4.0, 4=4.2, 5=5.0, 6=5.3. Matches the moc3 header byte. */
  latestMocVersion?: number
}

interface CubismCoreVersionApi {
  csmGetVersion?: () => number
  csmGetLatestMocVersion?: () => number
}

/** Reads the loaded Cubism Core's capabilities without throwing; missing APIs simply yield an empty result. */
export function getCubismCoreSupport(): CubismCoreSupport {
  if (typeof window === 'undefined') return {}
  const version = (
    window as Window & { Live2DCubismCore?: { Version?: CubismCoreVersionApi } }
  ).Live2DCubismCore?.Version
  if (!version) return {}
  const support: CubismCoreSupport = {}
  try {
    if (typeof version.csmGetVersion === 'function') support.coreVersion = version.csmGetVersion()
  } catch {
    // The wasm module may still be initializing; treat capabilities as unknown.
  }
  try {
    if (typeof version.csmGetLatestMocVersion === 'function')
      support.latestMocVersion = version.csmGetLatestMocVersion()
  } catch {
    // Same as above.
  }
  return support
}

/** The bundled yachiyo model is a Cubism 5.0 moc (header byte 5); a core older than that can never load it. */
export const BUILT_IN_REQUIRED_MOC_VERSION = 5
