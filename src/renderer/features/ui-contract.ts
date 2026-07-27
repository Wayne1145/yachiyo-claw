import type { ComponentType } from 'react'

/**
 * Renderer-side UI contribution contract for feature modules (Tier A).
 *
 * The platform-agnostic manifest lives in `src/shared/features/contract.ts`; this file is where React
 * enters, so `src/shared` never depends on the renderer. A later prompt wires these contributions into
 * the bottom navigation, settings home, and app-shell route allow-lists.
 */

/** Structural type every Tabler icon satisfies; avoids coupling to the icon package's exact export name. */
export type FeatureIcon = ComponentType<{
  size?: number | string
  stroke?: number | string
  color?: string
  className?: string
}>

export interface FeatureTabContribution {
  /** Must equal the manifest id or be prefixed by it. */
  id: string
  label: string
  icon: FeatureIcon
  /** Stable sort key for the bottom navigation. */
  order: number
  /** Route the tab activates, e.g. '/code'. */
  route: string
}

export interface FeatureSettingsEntry {
  /** Maps to the existing AndroidSettingsHome groups. */
  group: 'model' | 'capability' | 'app'
  label: string
  /** Desktop settings keeps the upstream English/i18n key while Android uses the product copy above. */
  desktopLabel?: string
  detail: string
  icon: FeatureIcon
  route: string
  order: number
  /** Narrow a cross-platform feature's settings surface without splitting its manifest. */
  platforms?: readonly ('android' | 'desktop' | 'web')[]
}

export interface FeatureUiContribution {
  featureId: string
  tab?: FeatureTabContribution
  tabs?: readonly FeatureTabContribution[]
  settingsEntries?: readonly FeatureSettingsEntry[]
  /** Always-mounted global components: approval dialog, permission wizard, scheduled-task runner. */
  overlays?: readonly ComponentType[]
  /** Routes this feature owns, used to converge the app-shell path allow-list. */
  ownedRoutes?: readonly string[]
}
