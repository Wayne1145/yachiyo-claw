import { z } from 'zod'

/**
 * Platform-agnostic feature-module contract (Tier A).
 *
 * This is the base every other plugin-migration step builds on. It intentionally imports nothing
 * from React, Capacitor, or the renderer so it can be validated in a plain node test environment.
 * UI contributions (tabs, settings entries, overlays) are layered on the renderer side — see
 * `src/renderer/features/ui-contract.ts`.
 */

export type FeaturePlatform = 'android' | 'desktop' | 'web'
export const FEATURE_PLATFORMS = ['android', 'desktop', 'web'] as const
export const FeaturePlatformSchema = z.enum(FEATURE_PLATFORMS)

/** Trust level bounds what a module may declare and whether a third party can ever provide it. */
export type FeatureTrust =
  | 'privileged' // may reach root / Shizuku / accessibility / arbitrary filesystem; built-in only
  | 'sandboxed' // only through the PRoot sandbox or an app-private directory
  | 'inert' // pure UI / pure in-app state, no external side effects
export const FEATURE_TRUSTS = ['privileged', 'sandboxed', 'inert'] as const
export const FeatureTrustSchema = z.enum(FEATURE_TRUSTS)

/** kebab-case, globally unique. Reused by the plugin manifest so ids share one grammar. */
export const FeatureIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Feature ids must be kebab-case')

// Reuse the Broker's tool-id grammar verbatim (src/shared/agent/contracts.ts) so a feature can never
// declare a toolId the Broker would later reject at call time.
const FeatureToolIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'Tool ids must be lowercase and namespaced')

export interface FeatureManifest {
  id: string
  displayName: string
  description: string
  platforms: readonly FeaturePlatform[]
  trust: FeatureTrust
  /** Ids of other modules this one depends on. The registry topologically sorts and detects cycles. */
  requires?: readonly string[]
  /** Whether the module is on by default. Privileged modules should default off. */
  enabledByDefault: boolean
  /** TOOL_IDS this module declares. A non-privileged module declaring a privileged id is rejected. */
  toolIds?: readonly string[]
  /** Android runtime permissions and native plugin names, for startup self-check and the permission wizard. */
  androidPermissions?: readonly string[]
  nativePlugins?: readonly string[]
}

export const FeatureManifestSchema = z
  .object({
    id: FeatureIdSchema,
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    platforms: z.array(FeaturePlatformSchema).min(1),
    trust: FeatureTrustSchema,
    requires: z.array(FeatureIdSchema).optional(),
    enabledByDefault: z.boolean(),
    toolIds: z.array(FeatureToolIdSchema).optional(),
    androidPermissions: z.array(z.string().trim().min(1).max(200)).optional(),
    nativePlugins: z.array(z.string().trim().min(1).max(200)).optional(),
  })
  .strict()

/**
 * Folds the runtime environment into a feature-platform tag.
 *
 * `FeaturePlatform` is NOT `PlatformType` (interfaces.ts): that union is web/desktop/mobile with no
 * 'android'. Android is decided by mobile + the `CHATBOX_BUILD_PLATFORM` build flag.
 */
export function resolveCurrentFeaturePlatform(input: {
  platformType: string
  buildPlatform?: string
}): FeaturePlatform {
  if (input.platformType === 'mobile' && input.buildPlatform === 'android') return 'android'
  if (input.platformType === 'desktop') return 'desktop'
  return 'web'
}
