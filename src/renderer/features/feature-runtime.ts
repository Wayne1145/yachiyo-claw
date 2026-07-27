import { resolveCurrentFeaturePlatform, type FeaturePlatform } from '@shared/features/contract'
import { getAllFeatures, resolveEnabledFeatures } from '@shared/features/registry'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import { registerBuiltinFeatures } from './builtin-features'

const unavailable = new Map<string, string>()

export function resolveRendererFeaturePlatform(
  platformType = platform.type,
  buildPlatform = CHATBOX_BUILD_PLATFORM,
): FeaturePlatform {
  return resolveCurrentFeaturePlatform({ platformType, buildPlatform })
}

export function setFeatureUnavailable(featureId: string, reason: string): void {
  unavailable.set(featureId, reason)
}

export function clearFeatureUnavailable(featureId?: string): void {
  if (featureId) unavailable.delete(featureId)
  else unavailable.clear()
}

export function getFeatureUnavailableReason(featureId: string): string | undefined {
  return unavailable.get(featureId)
}

export function getEnabledFeatureResolution(
  featurePlatform = resolveRendererFeaturePlatform(),
  overrides: Readonly<Record<string, boolean>> = settingsStore.getState().featureOverrides ?? {},
) {
  registerBuiltinFeatures()
  const resolved = resolveEnabledFeatures(getAllFeatures(), { platform: featurePlatform, overrides })
  return {
    ...resolved,
    enabled: resolved.enabled.filter((featureId) => !unavailable.has(featureId)),
  }
}

export function getDesiredFeatureIds(
  featurePlatform = resolveRendererFeaturePlatform(),
  overrides: Readonly<Record<string, boolean>> = settingsStore.getState().featureOverrides ?? {},
): ReadonlySet<string> {
  registerBuiltinFeatures()
  return new Set(resolveEnabledFeatures(getAllFeatures(), { platform: featurePlatform, overrides }).enabled)
}

export function getEnabledFeatureIds(
  featurePlatform = resolveRendererFeaturePlatform(),
  overrides?: Readonly<Record<string, boolean>>,
): ReadonlySet<string> {
  return new Set(getEnabledFeatureResolution(featurePlatform, overrides).enabled)
}
