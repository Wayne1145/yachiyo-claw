import { type FeatureManifest, FeatureManifestSchema, type FeaturePlatform } from './contract'
import { isPrivilegedToolId } from './privileged-tools'

/**
 * Platform-agnostic feature-module registry.
 *
 * Modeled on `src/shared/providers/registry.ts` (module-level Map + define/get/has/clear) so it reads
 * like the rest of the project. One deliberate difference: providers `console.warn` + overwrite on id
 * collision, but two feature modules claiming one id is a programming error that would silently drop
 * tools and navigation — so the feature registry THROWS on collision.
 */
const featureRegistry = new Map<string, FeatureManifest>()

export function registerFeature(manifest: FeatureManifest): FeatureManifest {
  // Validate shape first so a malformed manifest never reaches the privilege checks below.
  FeatureManifestSchema.parse(manifest)
  if (featureRegistry.has(manifest.id)) {
    throw new Error(`Feature "${manifest.id}" is already registered; feature ids must be globally unique.`)
  }
  assertNoPrivilegeEscalation(manifest)
  featureRegistry.set(manifest.id, manifest)
  return manifest
}

/** Security gate: only a `privileged` module may declare a privileged tool id. */
function assertNoPrivilegeEscalation(manifest: FeatureManifest): void {
  if (manifest.trust === 'privileged') return
  const escalated = (manifest.toolIds ?? []).filter(isPrivilegedToolId)
  if (escalated.length > 0) {
    throw new Error(
      `Feature "${manifest.id}" (trust=${manifest.trust}) cannot declare privileged tool ids: ${escalated.join(', ')}`,
    )
  }
}

export function getFeature(id: string): FeatureManifest | undefined {
  return featureRegistry.get(id)
}

export function getAllFeatures(): FeatureManifest[] {
  return Array.from(featureRegistry.values())
}

export function hasFeature(id: string): boolean {
  return featureRegistry.has(id)
}

export function resetFeatureRegistry(): void {
  featureRegistry.clear()
}

/**
 * Topologically orders manifests so every module appears after the ones it `requires`.
 * Throws on an unknown requirement or a dependency cycle, naming the ids on the cycle.
 */
export function resolveFeatureOrder(manifests: readonly FeatureManifest[]): FeatureManifest[] {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const ordered: FeatureManifest[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string, trail: string[]): void => {
    const status = state.get(id)
    if (status === 'done') return
    if (status === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(id)), id]
      throw new Error(`Feature dependency cycle: ${cycle.join(' -> ')}`)
    }
    const manifest = byId.get(id)
    if (!manifest) throw new Error(`Unknown required feature "${id}" (referenced by ${trail.join(' -> ') || 'root'})`)
    state.set(id, 'visiting')
    for (const requirement of manifest.requires ?? []) visit(requirement, [...trail, id])
    state.set(id, 'done')
    ordered.push(manifest)
  }

  for (const manifest of manifests) visit(manifest.id, [])
  return ordered
}

export interface ResolveEnabledInput {
  platform: FeaturePlatform
  /** User toggles: true forces on, false forces off, absent falls back to `enabledByDefault`. */
  overrides?: Readonly<Record<string, boolean>>
}

export interface ResolveEnabledResult {
  /** Final enabled set (a module plus its transitive requirements), in dependency order. */
  enabled: string[]
  /** Desired modules that could not be enabled because a requirement is unavailable or forced off. */
  blocked: Array<{ feature: string; missingRequirement: string }>
}

/**
 * Computes the final enabled set from platform applicability, defaults, user overrides and the
 * dependency closure. Enabling a module pulls in its `requires`; forcing a required module off does
 * not silently re-enable it — the depending modules are reported in `blocked` instead.
 */
export function resolveEnabledFeatures(
  manifests: readonly FeatureManifest[],
  { platform, overrides = {} }: ResolveEnabledInput,
): ResolveEnabledResult {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const applicable = (id: string): boolean => byId.get(id)?.platforms.includes(platform) ?? false
  const forcedOff = (id: string): boolean => overrides[id] === false
  const desired = manifests.filter(
    (manifest) => applicable(manifest.id) && (overrides[manifest.id] ?? manifest.enabledByDefault),
  )

  // Memoized reachability: can this id be enabled given platform + forced-off requirements?
  const decision = new Map<string, { ok: true } | { ok: false; missing: string }>()
  const canEnable = (id: string, trail: string[]): { ok: true } | { ok: false; missing: string } => {
    const cached = decision.get(id)
    if (cached) return cached
    if (trail.includes(id))
      throw new Error(`Feature dependency cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}`)
    let result: { ok: true } | { ok: false; missing: string }
    if (!byId.has(id) || !applicable(id) || forcedOff(id)) {
      result = { ok: false, missing: id }
    } else {
      result = { ok: true }
      for (const requirement of byId.get(id)?.requires ?? []) {
        const sub = canEnable(requirement, [...trail, id])
        if (!sub.ok) {
          result = { ok: false, missing: sub.missing }
          break
        }
      }
    }
    decision.set(id, result)
    return result
  }

  const enabledSet = new Set<string>()
  const blocked: ResolveEnabledResult['blocked'] = []
  for (const manifest of desired) {
    const verdict = canEnable(manifest.id, [])
    if (verdict.ok) {
      // Pull the whole requirement closure in with the module.
      const stack = [manifest.id]
      while (stack.length > 0) {
        const current = stack.pop() as string
        if (enabledSet.has(current)) continue
        enabledSet.add(current)
        for (const requirement of byId.get(current)?.requires ?? []) stack.push(requirement)
      }
    } else if (verdict.missing !== manifest.id) {
      blocked.push({ feature: manifest.id, missingRequirement: verdict.missing })
    } else {
      blocked.push({ feature: manifest.id, missingRequirement: manifest.id })
    }
  }

  const enabled = resolveFeatureOrder(manifests.filter((manifest) => enabledSet.has(manifest.id))).map(
    (manifest) => manifest.id,
  )
  return { enabled, blocked }
}
