import { Capacitor } from '@capacitor/core'
import type { FeatureManifest } from '@shared/features/contract'
import { getAllFeatures } from '@shared/features/registry'
import { clearFeatureUnavailable, setFeatureUnavailable } from './feature-runtime'
import { syncNativeFeatureGates } from '@/platform/native/feature-gated-plugin'

export interface NativeFeatureHealth {
  featureId: string
  available: boolean
  missingPlugins: string[]
  declaredPermissions: readonly string[]
}

let latestHealth: NativeFeatureHealth[] = []

export function getNativeFeatureHealth(): readonly NativeFeatureHealth[] {
  return latestHealth
}

export function checkFeatureNativeBridges(
  manifests: readonly FeatureManifest[],
  enabledFeatureIds: ReadonlySet<string>,
  isNativeAndroid: boolean,
  isPluginAvailable: (name: string) => boolean,
): NativeFeatureHealth[] {
  return manifests
    .filter((manifest) => manifest.platforms.includes('android') && enabledFeatureIds.has(manifest.id))
    .filter((manifest) => (manifest.nativePlugins?.length ?? 0) > 0 || (manifest.androidPermissions?.length ?? 0) > 0)
    .map((manifest) => {
      const missingPlugins = isNativeAndroid
        ? (manifest.nativePlugins ?? []).filter((pluginName) => !isPluginAvailable(pluginName))
        : []
      return {
        featureId: manifest.id,
        available: !isNativeAndroid || missingPlugins.length === 0,
        missingPlugins,
        declaredPermissions: manifest.androidPermissions ?? [],
      }
    })
}

/** Runs after Settings hydration, when Capacitor has installed the bridge but before feature UI mounts. */
export function runNativeFeatureSelfCheck(enabledFeatureIds: ReadonlySet<string>): NativeFeatureHealth[] {
  syncNativeFeatureGates(enabledFeatureIds)
  const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  latestHealth = checkFeatureNativeBridges(getAllFeatures(), enabledFeatureIds, nativeAndroid, (pluginName) =>
    Capacitor.isPluginAvailable(pluginName),
  )
  for (const health of latestHealth) {
    clearFeatureUnavailable(health.featureId)
    if (!health.available) {
      setFeatureUnavailable(health.featureId, `native_plugin_missing:${health.missingPlugins.join(',')}`)
    }
  }
  return latestHealth
}
