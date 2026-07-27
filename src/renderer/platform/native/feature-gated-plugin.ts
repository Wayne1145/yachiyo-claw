const enabledNativeFeatures = new Set<string>()
let initialized = false

/** Called after Settings hydration and whenever feature overrides change. */
export function syncNativeFeatureGates(enabledFeatureIds: ReadonlySet<string>): void {
  enabledNativeFeatures.clear()
  for (const id of enabledFeatureIds) enabledNativeFeatures.add(id)
  initialized = true
}

export function isNativeFeatureEnabled(featureId: string): boolean {
  // Before Settings hydration, preserve the historical default-enabled behavior.
  return !initialized || enabledNativeFeatures.has(featureId)
}

export function resetNativeFeatureGates(): void {
  enabledNativeFeatures.clear()
  initialized = false
}

/**
 * Keeps every first-party native class compiled into the APK while preventing calls when its
 * feature is disabled. Shared bridge methods are promise-based, so one typed facade covers them.
 */
export function createFeatureGatedPlugin<T extends object>(featureId: string, plugin: T): T {
  return new Proxy(plugin, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (isNativeFeatureEnabled(featureId)) return Reflect.apply(value, target, args)
        if (property === 'addListener') {
          return Promise.resolve({ remove: async () => {} })
        }
        return Promise.resolve({ available: false, reason: 'feature_disabled' })
      }
    },
  })
}
