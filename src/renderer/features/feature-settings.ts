import type { FeaturePlatform } from '@shared/features/contract'
import { getAllFeatures, getFeature, resolveEnabledFeatures } from '@shared/features/registry'
import { z } from 'zod'
import { persistSettingsPatch, settingsStore } from '@/stores/settingsStore'
import { syncNativeFeatureGates } from '@/platform/native/feature-gated-plugin'

export interface FeatureSettingsSpec<T> {
  featureId: string
  schema: z.ZodType<T>
  defaults: T
}

const settingsSpecs = new Map<string, FeatureSettingsSpec<unknown>>()

export function registerFeatureSettings<T>(spec: FeatureSettingsSpec<T>): void {
  if (settingsSpecs.has(spec.featureId)) {
    throw new Error(`Feature settings "${spec.featureId}" are already registered.`)
  }
  settingsSpecs.set(spec.featureId, spec as FeatureSettingsSpec<unknown>)
}

export function hasFeatureSettings(featureId: string): boolean {
  return settingsSpecs.has(featureId)
}

export function resetFeatureSettingsRegistry(): void {
  settingsSpecs.clear()
}

export function readFeatureSettings<T>(
  spec: FeatureSettingsSpec<T>,
  namespaces = settingsStore.getState().featureSettings,
): T {
  const parsed = spec.schema.safeParse(namespaces?.[spec.featureId])
  return parsed.success ? parsed.data : spec.defaults
}

export async function writeFeatureSettings<T>(spec: FeatureSettingsSpec<T>, value: T): Promise<void> {
  const parsed = spec.schema.parse(value)
  const current = settingsStore.getState().featureSettings ?? {}
  await persistSettingsPatch({
    featureSettings: {
      ...current,
      [spec.featureId]: parsed,
    },
  })
}

export function getFeatureOverrides(): Readonly<Record<string, boolean>> {
  return settingsStore.getState().featureOverrides ?? {}
}

export function resolveRuntimeFeatures(
  platform: FeaturePlatform,
  overrides: Readonly<Record<string, boolean>> = getFeatureOverrides(),
) {
  return resolveEnabledFeatures(getAllFeatures(), { platform, overrides })
}

export function previewFeatureToggle(
  featureId: string,
  enabled: boolean,
  platform: FeaturePlatform,
  overrides: Readonly<Record<string, boolean>> = getFeatureOverrides(),
) {
  if (!getFeature(featureId)) throw new Error(`Unknown feature "${featureId}".`)
  return resolveRuntimeFeatures(platform, { ...overrides, [featureId]: enabled })
}

export async function setFeatureEnabled(featureId: string, enabled: boolean, platform: FeaturePlatform) {
  const manifest = getFeature(featureId)
  if (!manifest) throw new Error(`Unknown feature "${featureId}".`)

  const next = { ...getFeatureOverrides() }
  if (enabled === manifest.enabledByDefault) delete next[featureId]
  else next[featureId] = enabled

  const resolution = resolveRuntimeFeatures(platform, next)
  await persistSettingsPatch({ featureOverrides: next })
  syncNativeFeatureGates(new Set(resolution.enabled))
  if (featureId === 'plugins' && !enabled) {
    const { disposeAllPluginRuntimes } = await import('@/plugins/plugin-manager')
    disposeAllPluginRuntimes()
  }
  return resolution
}

export interface FeatureLocalStore {
  has(name: string, version?: number): boolean
  get<T>(name: string, fallback: T, version?: number): T
  set<T>(name: string, value: T, version?: number): void
  remove(name: string, version?: number): void
}

/** Local caches and logs use a predictable namespace but deliberately do not join synced Settings. */
export function createFeatureLocalStore(featureId: string): FeatureLocalStore {
  const key = (name: string, version = 1) => `yachiyo:${featureId}:${name}:v${version}`
  return {
    has(name, version = 1): boolean {
      try {
        return globalThis.localStorage?.getItem(key(name, version)) != null
      } catch {
        return false
      }
    },
    get<T>(name: string, fallback: T, version = 1): T {
      try {
        const raw = globalThis.localStorage?.getItem(key(name, version))
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T)
      } catch {
        return fallback
      }
    },
    set<T>(name: string, value: T, version = 1): void {
      try {
        globalThis.localStorage?.setItem(key(name, version), JSON.stringify(value))
      } catch {
        // A full or unavailable storage backend must not crash the feature using a local cache.
      }
    },
    remove(name: string, version = 1): void {
      try {
        globalThis.localStorage?.removeItem(key(name, version))
      } catch {
        // Removal is best effort for the same reason as writes.
      }
    },
  }
}
