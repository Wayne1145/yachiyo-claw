import { z } from 'zod'
import { FeatureIdSchema } from '../features/contract'
import { PLUGIN_CAPABILITIES } from './manifest'

/**
 * Plugin authorization model (platform-23 pure core).
 *
 * The host consent dialog, Keystore-encrypted grant store, and revocation UI route every capability
 * check through this default-deny evaluator. Invariants encoded
 * here: a missing/ambiguous grant is unauthorized; a `denied` grant stays denied; a grant is bound to
 * the exact plugin code (`boundEntrySha256`) so any code change forces re-consent; device/network
 * grants may expire; network grants only permit the hosts they name.
 */

export const PLUGIN_GRANT_STATES = ['granted', 'denied', 'revoked'] as const
export type PluginGrantState = (typeof PLUGIN_GRANT_STATES)[number]

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex digest')
const HostnameSchema = z
  .string()
  .trim()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/i, 'Expected a bare hostname')

export const PluginGrantSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: FeatureIdSchema,
    capability: z.enum(PLUGIN_CAPABILITIES),
    state: z.enum(PLUGIN_GRANT_STATES),
    /** The plugin entry digest this decision was made against. A code change invalidates the grant. */
    boundEntrySha256: Sha256Schema,
    decidedAt: z.number().int().nonnegative(),
    /** Absolute ms deadline; null means until explicitly revoked. */
    expiresAt: z.number().int().nonnegative().nullable(),
    /** network only: the hosts this grant permits. */
    domains: z.array(HostnameSchema).min(1).max(64).optional(),
  })
  .strict()
export type PluginGrant = z.infer<typeof PluginGrantSchema>

export interface GrantCheckContext {
  pluginId?: string
  capability: (typeof PLUGIN_CAPABILITIES)[number]
  /** The plugin's current entry digest, compared against the grant's bound digest. */
  currentEntrySha256: string
  now: number
  /** network only: the host the plugin is trying to reach. */
  host?: string
}

export type GrantEvaluation = { allowed: true } | { allowed: false; reason: string }

/** The single authorization decision point. Default-deny: anything uncertain returns not-allowed. */
export function evaluatePluginGrant(
  grant: PluginGrant | null | undefined,
  context: GrantCheckContext,
): GrantEvaluation {
  if (!grant) return { allowed: false, reason: 'no_grant' }
  if (context.pluginId && grant.pluginId !== context.pluginId) return { allowed: false, reason: 'plugin_mismatch' }
  if (grant.capability !== context.capability) return { allowed: false, reason: 'capability_mismatch' }
  if (grant.state !== 'granted') return { allowed: false, reason: 'not_granted' }
  if (grant.boundEntrySha256.toLowerCase() !== context.currentEntrySha256.toLowerCase()) {
    return { allowed: false, reason: 're_consent_required' }
  }
  if (grant.expiresAt !== null && grant.expiresAt <= context.now) return { allowed: false, reason: 'expired' }
  if (context.capability === 'network') {
    const host = context.host?.trim().toLowerCase()
    if (!host) return { allowed: false, reason: 'host_required' }
    if (!grant.domains?.some((domain) => domain.trim().toLowerCase() === host)) {
      return { allowed: false, reason: 'domain_not_allowed' }
    }
  }
  return { allowed: true }
}

/** Whether a stored decision should suppress re-prompting the user for the same capability. */
export function shouldSuppressPrompt(grant: PluginGrant | null | undefined, currentEntrySha256: string): boolean {
  if (!grant) return false
  // A denial stands until the management UI resets it. A grant only stands while the code is unchanged.
  if (grant.state === 'denied' || grant.state === 'revoked') return true
  return grant.boundEntrySha256.toLowerCase() === currentEntrySha256.toLowerCase()
}
