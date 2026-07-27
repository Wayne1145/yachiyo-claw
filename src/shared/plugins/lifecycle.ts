import { compareVersions } from 'compare-versions'
import type { PluginManifest } from './manifest'

/**
 * Plugin lifecycle rules (platform-29), pure and test-locked.
 *
 * Updates are strictly user-initiated — automatic updates plus previously-granted device permission
 * would equal remote code execution, so no code path here triggers an update on its own. (The Skills
 * pipeline both fakes its mobile update check and silently wipes granted capabilities on update —
 * documented defects; these rules exist so the plugin platform does neither.)
 */

export type GrantPreservation = 'preserve' | 'reconsent'

export interface UpdateGrantContext {
  oldManifest: PluginManifest
  newManifest: PluginManifest
  oldSignerKeyId?: string
  newSignerKeyId?: string
}

/**
 * Decides, per capability of the NEW manifest, whether an existing grant carries over (rebinding to
 * the new digest) or the user must re-consent:
 * - capability newly added → reconsent
 * - signer changed (or signature disappeared) → reconsent for everything
 * - network domain list not a subset of the old one → reconsent for network
 * - `device` → ALWAYS reconsent, no exception
 */
export function evaluateGrantPreservation(context: UpdateGrantContext): Record<string, GrantPreservation> {
  const oldCapabilities = new Map(context.oldManifest.capabilities.map((capability) => [capability.name, capability]))
  // Unsigned code has no stable author identity, so every update requires fresh consent.
  const signerChanged =
    !context.oldSignerKeyId || !context.newSignerKeyId || context.oldSignerKeyId !== context.newSignerKeyId
  const result: Record<string, GrantPreservation> = {}
  for (const capability of context.newManifest.capabilities) {
    if (capability.name === 'device') {
      result[capability.name] = 'reconsent'
      continue
    }
    const previous = oldCapabilities.get(capability.name)
    if (!previous || signerChanged) {
      result[capability.name] = 'reconsent'
      continue
    }
    if (capability.name === 'network') {
      const oldDomains = new Set((previous.domains ?? []).map((domain) => domain.toLowerCase()))
      const widened = (capability.domains ?? []).some((domain) => !oldDomains.has(domain.toLowerCase()))
      result[capability.name] = widened ? 'reconsent' : 'preserve'
      continue
    }
    result[capability.name] = 'preserve'
  }
  return result
}

/** minAppVersion gate: incompatible plugins are disabled, never loaded. */
export function isPluginCompatible(manifest: Pick<PluginManifest, 'minAppVersion'>, appVersion: string): boolean {
  if (!manifest.minAppVersion) return true
  try {
    return compareVersions(manifest.minAppVersion, appVersion) <= 0
  } catch {
    return false
  }
}

export const HEALTH_AUTO_DISABLE_THRESHOLD = 3

export interface PluginHealth {
  consecutiveFailures: number
  totalFailures: number
  totalTimeouts: number
  lastError?: string
  /** Set when consecutive failures crossed the threshold; cleared by an explicit user re-enable. */
  disabledReason?: string
}

export const EMPTY_HEALTH: PluginHealth = { consecutiveFailures: 0, totalFailures: 0, totalTimeouts: 0 }

export function recordPluginFailure(health: PluginHealth, kind: 'error' | 'timeout', message: string): PluginHealth {
  const consecutiveFailures = health.consecutiveFailures + 1
  return {
    consecutiveFailures,
    totalFailures: health.totalFailures + 1,
    totalTimeouts: health.totalTimeouts + (kind === 'timeout' ? 1 : 0),
    lastError: message.slice(0, 300),
    disabledReason:
      health.disabledReason ??
      (consecutiveFailures >= HEALTH_AUTO_DISABLE_THRESHOLD
        ? `连续失败 ${consecutiveFailures} 次已自动禁用`
        : undefined),
  }
}

export function recordPluginSuccess(health: PluginHealth): PluginHealth {
  // Success resets the streak but never un-disables: re-enabling is an explicit user action.
  return { ...health, consecutiveFailures: 0 }
}

export function reenablePlugin(health: PluginHealth): PluginHealth {
  return { ...health, consecutiveFailures: 0, disabledReason: undefined }
}
