import { compareVersions } from 'compare-versions'
import type { PluginManifest } from '@shared/plugins/manifest'
import type { PluginMarketplaceEntry } from '@shared/plugins/marketplace'
import type { InstalledPluginRecord } from './installer'

export interface PluginCapabilityChanges {
  added: string[]
  removed: string[]
  expandedDomains: string[]
}

export interface PluginUpdateChanges {
  capabilityChanges: PluginCapabilityChanges
  signerChanged: boolean
}

function declaredDomains(manifest: PluginManifest): Set<string> {
  return new Set(
    manifest.capabilities
      .find((capability) => capability.name === 'network')
      ?.domains?.map((domain) => domain.toLowerCase()) ?? [],
  )
}

/** Computes the authority-relevant changes shown before a user confirms an update. */
/** 计算更新确认前展示给用户的权限相关变更。 */
export function describePluginUpdate(
  current: InstalledPluginRecord,
  candidate: PluginManifest,
  candidateSignerKeyId?: string,
): PluginUpdateChanges {
  const oldCapabilities = new Set(current.manifest.capabilities.map((capability) => capability.name))
  const newCapabilities = new Set(candidate.capabilities.map((capability) => capability.name))
  const oldDomains = declaredDomains(current.manifest)
  const newDomains = declaredDomains(candidate)
  return {
    capabilityChanges: {
      added: [...newCapabilities].filter((capability) => !oldCapabilities.has(capability)).sort(),
      removed: [...oldCapabilities].filter((capability) => !newCapabilities.has(capability)).sort(),
      expandedDomains: [...newDomains].filter((domain) => !oldDomains.has(domain)).sort(),
    },
    signerChanged: (current.signerKeyId ?? null) !== (candidateSignerKeyId ?? null),
  }
}

export function isNewerPluginVersion(currentVersion: string, candidateVersion: string): boolean {
  try {
    return compareVersions(candidateVersion, currentVersion) > 0
  } catch {
    return false
  }
}

/** Metadata-only batch check for verified marketplace plugins; it never downloads or runs code. */
/** 仅检查已验证市场插件的元数据，绝不下载或运行代码。 */
export function findMarketplacePluginUpdates(
  installed: InstalledPluginRecord[],
  entries: PluginMarketplaceEntry[],
): Map<string, PluginMarketplaceEntry> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const updates = new Map<string, PluginMarketplaceEntry>()
  for (const record of installed) {
    if (record.source !== 'marketplace' && record.updateSource?.kind !== 'marketplace') continue
    const candidate = byId.get(record.manifest.id)
    if (candidate && isNewerPluginVersion(record.manifest.version, candidate.version)) {
      updates.set(record.manifest.id, candidate)
    }
  }
  return updates
}
