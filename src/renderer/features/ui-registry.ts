import type { FeaturePlatform } from '@shared/features/contract'
import { resolveEnabledFeatures, getAllFeatures } from '@shared/features/registry'
import type { ComponentType } from 'react'
import type { FeatureSettingsEntry, FeatureTabContribution, FeatureUiContribution } from './ui-contract'

const contributions = new Map<string, FeatureUiContribution>()
const overlayContributions = new Map<string, readonly ComponentType[]>()

export interface FeatureUiEnvironment {
  platform: FeaturePlatform
  overrides?: Readonly<Record<string, boolean>>
  enabledFeatureIds?: ReadonlySet<string>
}

function enabledIds(environment: FeatureUiEnvironment): ReadonlySet<string> {
  if (environment.enabledFeatureIds) return environment.enabledFeatureIds
  return new Set(
    resolveEnabledFeatures(getAllFeatures(), {
      platform: environment.platform,
      overrides: environment.overrides,
    }).enabled,
  )
}

function isEnabled(featureId: string, ids: ReadonlySet<string>): boolean {
  return featureId === 'core' || ids.has(featureId)
}

export function registerFeatureUi(contribution: FeatureUiContribution): void {
  if (contributions.has(contribution.featureId)) {
    throw new Error(`Feature UI "${contribution.featureId}" is already registered.`)
  }
  const tabs = [...(contribution.tab ? [contribution.tab] : []), ...(contribution.tabs ?? [])]
  const seen = new Set<string>()
  for (const tab of tabs) {
    if (seen.has(tab.id)) throw new Error(`Feature UI "${contribution.featureId}" declares duplicate tab "${tab.id}".`)
    seen.add(tab.id)
  }
  contributions.set(contribution.featureId, contribution)
}

export function hasFeatureUi(featureId: string): boolean {
  return contributions.has(featureId)
}

export function resetFeatureUiRegistry(): void {
  contributions.clear()
  overlayContributions.clear()
}

export function registerFeatureOverlays(featureId: string, overlays: readonly ComponentType[]): void {
  if (overlayContributions.has(featureId)) throw new Error(`Feature overlays "${featureId}" are already registered.`)
  overlayContributions.set(featureId, overlays)
}

export function hasFeatureOverlays(featureId: string): boolean {
  return overlayContributions.has(featureId)
}

export function getEnabledTabs(environment: FeatureUiEnvironment): FeatureTabContribution[] {
  const ids = enabledIds(environment)
  const tabs = Array.from(contributions.values())
    .filter((contribution) => isEnabled(contribution.featureId, ids))
    .flatMap((contribution) => [...(contribution.tab ? [contribution.tab] : []), ...(contribution.tabs ?? [])])
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  if (tabs.length > 5) {
    console.warn(`Android bottom navigation supports at most five tabs; hiding ${tabs.length - 5} overflow tab(s).`)
  }
  return tabs.slice(0, 5)
}

export function getSettingsEntries(
  group: FeatureSettingsEntry['group'],
  environment: FeatureUiEnvironment,
): FeatureSettingsEntry[] {
  const ids = enabledIds(environment)
  return Array.from(contributions.values())
    .filter((contribution) => isEnabled(contribution.featureId, ids))
    .flatMap((contribution) => contribution.settingsEntries ?? [])
    .filter((entry) => entry.group === group && (!entry.platforms || entry.platforms.includes(environment.platform)))
    .sort((a, b) => a.order - b.order || a.route.localeCompare(b.route))
}

export function getOverlays(environment: FeatureUiEnvironment): ComponentType[] {
  const ids = enabledIds(environment)
  const declared = Array.from(contributions.values())
    .filter((contribution) => isEnabled(contribution.featureId, ids))
    .flatMap((contribution) => contribution.overlays ?? [])
  const separatelyRegistered = Array.from(overlayContributions.entries())
    .filter(([featureId]) => isEnabled(featureId, ids))
    .flatMap(([, overlays]) => overlays)
  return [...declared, ...separatelyRegistered]
}

export function getOwnedRoutes(environment: FeatureUiEnvironment): string[] {
  const ids = enabledIds(environment)
  return Array.from(
    new Set(
      Array.from(contributions.values())
        .filter((contribution) => isEnabled(contribution.featureId, ids))
        .flatMap((contribution) => [
          ...(contribution.tab ? [contribution.tab.route] : []),
          ...(contribution.tabs ?? []).map((tab) => tab.route),
          ...(contribution.ownedRoutes ?? []),
        ]),
    ),
  )
}

export function findFeatureTabForPath(
  pathname: string,
  environment: FeatureUiEnvironment,
): FeatureTabContribution | undefined {
  const tabs = getEnabledTabs(environment)
  const direct = tabs.find((tab) => routeMatchesFeaturePath(pathname, tab.route))
  if (direct) return direct
  const ids = enabledIds(environment)
  for (const contribution of contributions.values()) {
    if (!isEnabled(contribution.featureId, ids)) continue
    const tab = contribution.tab ?? (contribution.tabs?.length === 1 ? contribution.tabs[0] : undefined)
    if (tab && contribution.ownedRoutes?.some((route) => routeMatchesFeaturePath(pathname, route))) return tab
  }
  return undefined
}

export function routeMatchesFeaturePath(pathname: string, route: string): boolean {
  if (route.endsWith('/*')) {
    const base = route.slice(0, -2)
    return pathname === base || pathname.startsWith(`${base}/`)
  }
  return pathname === route
}
