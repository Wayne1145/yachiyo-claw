import { compareVersions } from 'compare-versions'
import { z } from 'zod'
import { JsonValueSchema } from '../agent/contracts'
import { FeatureIdSchema } from '../features/contract'
import { SkillExecutionModeSchema, SkillFileManifestSchema, SkillSignatureSchema } from '../types/skills'
import { isPrivateNetworkHost } from './network-policy'

/**
 * Installable-plugin manifest schema + parser (Tier B).
 *
 * This activates three schemas that shipped in `src/shared/types/skills.ts` but were never wired up:
 * `SkillFileManifestSchema` (per-file digest list), `SkillSignatureSchema` (ed25519 signature shape),
 * and `SkillExecutionModeSchema` (declarative vs script). It does NOT reuse
 * `SkillExecutableManifestSchema` — that is a script-entrypoint manifest with different semantics.
 *
 * Format and parsing only. No verification, unpacking, install, or runtime here.
 */

export const PLUGIN_SCHEMA_VERSION = 1 as const

export const PLUGIN_CAPABILITIES = [
  'storage', // read/write its own namespace
  'ui', // contribute declarative UI
  'tools', // contribute non-privileged Agent tools
  'sandbox', // run commands in the PRoot sandbox
  'network', // make HTTP requests (must carry a domain allow-list)
  'device', // device control (most dangerous; never granted at install time)
] as const
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

const hasSafeDisplayText = (value: string) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)

// Same-strength path guard as SkillScriptEntrypointSchema (skills.ts): reject absolute paths, drive
// letters, backslashes, and any empty / '.' / '..' segment. Not relaxed for plugins.
export function isSafePackageRelativePath(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    !value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  )
}

const PackageRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isSafePackageRelativePath, 'Path must be a safe package-relative path')

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex digest')
// A bare hostname: labels of letters/digits/hyphen, at least two labels, no scheme/port/path/wildcard.
const HostnameSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/i,
    'Expected a bare hostname without scheme, port, path, or wildcard'
  )
  .refine((value) => !isPrivateNetworkHost(value), 'Private or local-only hosts are not allowed')

const CapabilityRequestSchema = z
  .object({
    name: z.enum(PLUGIN_CAPABILITIES),
    // The only thing the user sees when deciding. Must be specific, so blank / near-empty is rejected.
    reason: z
      .string()
      .trim()
      .min(10, 'Capability reason must explain why it is needed')
      .max(500)
      .refine(hasSafeDisplayText, 'Capability reason contains unsafe control characters'),
    // Network only: explicit host-proxy allow-list. The opaque Worker CSP blocks ambient egress; this
    // list controls the only supported network path and must remain exact.
    domains: z.array(HostnameSchema).min(1).max(64).optional(),
  })
  .strict()
  .superRefine((capability, context) => {
    if (capability.name === 'network') {
      if (!capability.domains || capability.domains.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'The network capability must declare a non-empty domain allow-list.',
          path: ['domains'],
        })
      }
    } else if (capability.domains) {
      context.addIssue({
        code: 'custom',
        message: 'Only the network capability may declare domains.',
        path: ['domains'],
      })
    }
  })

const PluginTabSchema = z
  .object({
    label: z.string().trim().min(1).max(60).refine(hasSafeDisplayText, 'Label contains unsafe control characters'),
    route: z.string().trim().min(1).max(256),
    order: z.number().int(),
    // Icon is a bundled asset path or a known icon name (a string), never a component in JSON.
    icon: z.string().trim().min(1).max(128).optional(),
  })
  .strict()

const PluginSettingsEntrySchema = z
  .object({
    group: z.enum(['model', 'capability', 'app']),
    label: z.string().trim().min(1).max(60).refine(hasSafeDisplayText, 'Label contains unsafe control characters'),
    detail: z.string().trim().min(1).max(200).refine(hasSafeDisplayText, 'Detail contains unsafe control characters'),
    route: z.string().trim().min(1).max(256),
    order: z.number().int(),
    icon: z.string().trim().min(1).max(128).optional(),
  })
  .strict()

const PluginToolContributionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'Tool names must be lowercase and namespaced'),
    // Bounded because every description lands in the system prompt (token cost / DoS).
    description: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(hasSafeDisplayText, 'Tool description contains unsafe control characters'),
    /** JSON Schema for the tool input; validated against the restricted subset at registration. */
    parameters: JsonValueSchema.optional(),
    // Plugin tools cap out at 'act'. sensitive/destructive capability goes through the device
    // capability path (plat-26), never through a manifest field.
    riskLevel: z.enum(['read', 'act']).default('read'),
  })
  .strict()

const PluginContributionsSchema = z
  .object({
    /** Bundled declarative view JSON rendered by the host. */
    view: PackageRelativePathSchema.optional(),
    tab: PluginTabSchema.optional(),
    settingsEntries: z.array(PluginSettingsEntrySchema).max(16).optional(),
    // Per-plugin tool cap: each tool's name+description+schema occupies system-prompt tokens.
    tools: z.array(PluginToolContributionSchema).max(8).optional(),
  })
  .strict()

export const PluginManifestSchema = z
  .object({
    schemaVersion: z.literal(PLUGIN_SCHEMA_VERSION),
    id: FeatureIdSchema,
    version: z.string().trim().min(1).max(64).refine(hasSafeDisplayText, 'Version contains unsafe control characters'),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(hasSafeDisplayText, 'Display name contains unsafe control characters'),
    description: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(hasSafeDisplayText, 'Description contains unsafe control characters'),
    author: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .refine(hasSafeDisplayText, 'Author name contains unsafe control characters'),
        url: z.string().url().max(300).optional(),
      })
      .strict()
      .optional(),
    license: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(hasSafeDisplayText, 'License contains unsafe control characters')
      .optional(),
    minAppVersion: z.string().trim().min(1).max(64).optional(),
    // A declarative plugin (UI + settings only) omits entry/entrySha256; scripted plugins require both.
    mode: SkillExecutionModeSchema.optional(),
    entry: PackageRelativePathSchema.optional(),
    entrySha256: Sha256Schema.optional(),
    capabilities: z.array(CapabilityRequestSchema).max(16).default([]),
    contributions: PluginContributionsSchema.default({}),
    files: z.array(SkillFileManifestSchema).min(1).max(512),
    signature: SkillSignatureSchema.optional(),
  })
  .strict()

export type PluginManifest = z.infer<typeof PluginManifestSchema>

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

/**
 * Strictly parses and cross-validates a plugin manifest. Beyond the field schema this enforces:
 * declarative vs scripted consistency, entry ∈ files with a matching digest, namespaced routes and
 * tool names, capability ⇄ contribution agreement, and minimum app version.
 */
export function parsePluginManifest(json: unknown, options: { appVersion?: string } = {}): PluginManifest {
  const result = PluginManifestSchema.safeParse(json)
  if (!result.success) {
    throw new PluginManifestError(
      `Invalid plugin manifest: ${result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`
    )
  }
  const manifest = result.data
  const declared = new Set(manifest.capabilities.map((capability) => capability.name))
  if (declared.size !== manifest.capabilities.length)
    throw new PluginManifestError('Capabilities must not be declared more than once.')
  for (const capability of manifest.capabilities) {
    if (
      capability.domains &&
      new Set(capability.domains.map((domain) => domain.toLowerCase())).size !== capability.domains.length
    ) {
      throw new PluginManifestError(`Capability "${capability.name}" contains duplicate domains.`)
    }
  }
  const effectiveMode = manifest.mode ?? (manifest.entry ? 'script-enabled' : 'declarative')

  if (effectiveMode === 'declarative') {
    if (manifest.entry || manifest.entrySha256)
      throw new PluginManifestError('A declarative plugin must not declare an entry script.')
    if (manifest.contributions.tools?.length)
      throw new PluginManifestError('A declarative plugin cannot contribute tools (no code to run them).')
  } else {
    if (!manifest.entry || !manifest.entrySha256)
      throw new PluginManifestError('A scripted plugin must declare both entry and entrySha256.')
    const file = manifest.files.find((entry) => entry.path === manifest.entry)
    if (!file) throw new PluginManifestError(`entry "${manifest.entry}" is not listed in files[].`)
    if (!file.sha256) throw new PluginManifestError(`The files[] entry for "${manifest.entry}" must carry a sha256.`)
    if (file.sha256.toLowerCase() !== manifest.entrySha256.toLowerCase()) {
      throw new PluginManifestError('entrySha256 does not match the files[] digest for the entry.')
    }
  }

  // Every declared file path must pass the same-strength traversal guard as the entry.
  for (const file of manifest.files) {
    if (!isSafePackageRelativePath(file.path)) throw new PluginManifestError(`Unsafe file path "${file.path}".`)
    if (!file.sha256) throw new PluginManifestError(`File "${file.path}" must carry a sha256 digest.`)
  }

  const routePrefix = `/plugin/${manifest.id}`
  const assertNamespacedRoute = (route: string, where: string) => {
    if (route !== routePrefix && !route.startsWith(`${routePrefix}/`)) {
      throw new PluginManifestError(`${where} route "${route}" must start with "${routePrefix}".`)
    }
  }

  if (manifest.contributions.tab) {
    if (!declared.has('ui')) throw new PluginManifestError('Declaring a tab requires the "ui" capability.')
    assertNamespacedRoute(manifest.contributions.tab.route, 'tab')
  }
  if (manifest.contributions.view) {
    if (!declared.has('ui')) throw new PluginManifestError('Declaring a view requires the "ui" capability.')
    const viewFile = manifest.files.find((entry) => entry.path === manifest.contributions.view)
    if (!viewFile) throw new PluginManifestError(`View "${manifest.contributions.view}" is not listed in files[].`)
    if (!viewFile.sha256) throw new PluginManifestError('A declarative view file must carry a sha256 digest.')
  }
  for (const entry of manifest.contributions.settingsEntries ?? []) {
    if (!declared.has('ui')) throw new PluginManifestError('Declaring settings entries requires the "ui" capability.')
    assertNamespacedRoute(entry.route, 'settings')
  }
  if (manifest.contributions.tools?.length) {
    if (!declared.has('tools')) throw new PluginManifestError('Declaring tools requires the "tools" capability.')
    const names = new Set<string>()
    for (const tool of manifest.contributions.tools) {
      if (names.has(tool.name)) throw new PluginManifestError(`Tool "${tool.name}" is declared more than once.`)
      names.add(tool.name)
      if (!tool.name.startsWith(`${manifest.id}_`)) {
        throw new PluginManifestError(`Tool "${tool.name}" must be prefixed with "${manifest.id}_".`)
      }
    }
  }

  if (manifest.minAppVersion && options.appVersion) {
    try {
      if (compareVersions(manifest.minAppVersion, options.appVersion) > 0) {
        throw new PluginManifestError(
          `This plugin requires app version ${manifest.minAppVersion} or newer (current ${options.appVersion}).`
        )
      }
    } catch (error) {
      if (error instanceof PluginManifestError) throw error
      throw new PluginManifestError(`Invalid minAppVersion "${manifest.minAppVersion}".`)
    }
  }

  return manifest
}
