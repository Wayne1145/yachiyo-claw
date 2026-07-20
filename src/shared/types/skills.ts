import { z } from 'zod'

// ===== Skill Source Types =====

/**
 * SkillSource: Metadata about where a skill comes from
 * - type: Source type (builtin, local, marketplace, github)
 * - repo: Optional repository URL or identifier
 * - commitHash: Optional commit hash for version tracking
 * - installedAt: Optional ISO timestamp of installation
 * - skillPath: Optional file system path to skill
 */
export interface SkillSource {
  type: 'builtin' | 'local' | 'marketplace' | 'github' | 'skillhub'
  repo?: string
  commitHash?: string
  installedAt?: string
  skillPath?: string
  slug?: string
  version?: string
  revision?: string
  filesHash?: string
  signature?: SkillSignature
  publisher?: string
  securityReport?: string
  requiresApiKeys?: string[]
  capabilityManifest?: SkillCapabilityManifest
}

/**
 * MarketplaceSkill: Skill metadata from marketplace
 * - id: Unique marketplace identifier
 * - skillId: Skill identifier
 * - name: Display name
 * - installs: Number of installations
 * - source: Source identifier or URL
 * - description: Optional description
 */
export interface MarketplaceSkill {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
  description?: string
  slug?: string
  version?: string
  revision?: string
  filesHash?: string
  signature?: SkillSignature
  publisher?: string
  securityReport?: string
  requiresApiKeys?: string[]
  capabilityManifest?: SkillCapabilityManifest
}

// ===== Skill Metadata Types =====

/**
 * SkillMetadata: Core metadata for a skill from agentskills.io spec
 * - name: 1-64 chars, lowercase + hyphens only
 * - description: 1-1024 chars
 * - license: Optional license identifier
 * - compatibility: Optional compatibility info (1-500 chars)
 * - metadata: Optional arbitrary metadata key-value pairs
 * - allowedTools: Optional list of allowed tool names
 */
export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

/**
 * SkillInfo: Extended skill metadata with runtime information
 * - Extends SkillMetadata with path and isBuiltin
 * - path: File system path to the skill
 * - isBuiltin: Whether this is a built-in skill
 * - bodyTokenEstimate: Optional estimated token count for skill body
 * - source: Optional source metadata (builtin, local, marketplace, github)
 */
export interface SkillInfo extends SkillMetadata {
  path: string
  isBuiltin: boolean
  bodyTokenEstimate?: number
  source?: SkillSource
  scriptExecutionEnabled?: boolean
  signatureVerified?: boolean
}

// ===== Zod Schemas =====

/**
 * Zod schema for skill settings
 * - enabledSkillNames: Array of custom skill names to enable
 * - translationEnabled: Whether translation feature is enabled for skills
 */
export const SkillSettingsSchema = z.object({
  enabledSkillNames: z.array(z.string()).default([]),
  translationEnabled: z.boolean().default(true),
})

const SkillIdentifierSchema = z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/, 'Invalid skill identifier')

export const SkillCapabilityManifestSchema = z
  .object({
    network: z.boolean().optional(),
    filesystem: z.boolean().optional(),
    scripts: z.boolean().optional(),
    privileged: z.boolean().optional(),
    tools: z.array(z.string().min(1).max(128)).max(256).optional(),
    scriptEntrypoints: z.array(z.lazy(() => SkillScriptEntrypointSchema)).max(32).optional(),
  })
  .strict()

export const SkillSignatureSchema = z
  .object({
    algorithm: z.literal('ed25519'),
    value: z.string().min(1),
    keyId: z.string().min(1).max(256).optional(),
    publicKey: z.string().min(1).optional(),
  })
  .strict()

export const SkillFileManifestSchema = z
  .object({
    path: z.string().min(1).max(1024),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    contentType: z.string().max(255).optional(),
    executable: z.boolean().optional(),
  })
  .strict()

export const SkillScriptRuntimeSchema = z.enum(['shell', 'python', 'javascript'])
export const SkillScriptCapabilitySchema = z.enum(['unrestricted-privileged'])
export const SkillScriptEntrypointSchema = z
  .object({
    name: SkillIdentifierSchema,
    path: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !/^[A-Za-z]:/.test(value) &&
          !value.includes('\\') &&
          !value.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
        'Script path must be a safe package-relative path'
      ),
    runtime: SkillScriptRuntimeSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    size: z.number().int().positive().max(256 * 1024),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
    workingDirectory: z.enum(['skill-private', 'workspace']).default('skill-private'),
    isolation: z.literal('none'),
    capabilities: z.array(SkillScriptCapabilitySchema).length(1),
  })
  .strict()

export const SkillExecutableManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entrypoints: z.array(SkillScriptEntrypointSchema).min(1).max(32),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = new Set<string>()
    const paths = new Set<string>()
    for (const [index, entrypoint] of manifest.entrypoints.entries()) {
      if (names.has(entrypoint.name)) {
        context.addIssue({ code: 'custom', message: 'Duplicate script entrypoint name', path: ['entrypoints', index, 'name'] })
      }
      if (paths.has(entrypoint.path)) {
        context.addIssue({ code: 'custom', message: 'Duplicate script entrypoint path', path: ['entrypoints', index, 'path'] })
      }
      names.add(entrypoint.name)
      paths.add(entrypoint.path)
    }
  })

export const SkillExecutionModeSchema = z.enum(['declarative', 'script-disabled', 'script-enabled'])

export const MarketplaceSkillSchema = z
  .object({
    id: z.string().min(1),
    skillId: SkillIdentifierSchema,
    name: z.string().min(1).max(256),
    installs: z.number().int().nonnegative().default(0),
    source: z.string().min(1).max(2048),
    description: z.string().max(4096).optional(),
    slug: SkillIdentifierSchema.optional(),
    version: z.string().max(128).optional(),
    revision: z.string().max(256).optional(),
    filesHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    signature: SkillSignatureSchema.optional(),
    publisher: z.string().max(256).optional(),
    securityReport: z.string().url().optional(),
    requiresApiKeys: z.array(z.string().min(1).max(128)).max(64).optional(),
    capabilityManifest: SkillCapabilityManifestSchema.optional(),
  })
  .strict()

export const SkillInstallRecordSchema = z
  .object({
    id: z.string().min(1).max(256),
    slug: SkillIdentifierSchema,
    name: z.string().min(1).max(256),
    version: z.string().max(128).optional(),
    revision: z.string().max(256).optional(),
    source: z.custom<SkillSource>(),
    files: z.array(SkillFileManifestSchema).max(4096),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    signatureVerified: z.boolean(),
    executionMode: SkillExecutionModeSchema,
    enabled: z.boolean(),
    installedAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()

// ===== Type Exports =====

export type SkillSettings = z.infer<typeof SkillSettingsSchema>
export type SkillCapabilityManifest = z.infer<typeof SkillCapabilityManifestSchema>
export type SkillSignature = z.infer<typeof SkillSignatureSchema>
export type SkillFileManifest = z.infer<typeof SkillFileManifestSchema>
export type SkillInstallRecord = z.infer<typeof SkillInstallRecordSchema>
export type SkillScriptRuntime = z.infer<typeof SkillScriptRuntimeSchema>
export type SkillScriptCapability = z.infer<typeof SkillScriptCapabilitySchema>
export type SkillScriptEntrypoint = z.infer<typeof SkillScriptEntrypointSchema>
export type SkillExecutableManifest = z.infer<typeof SkillExecutableManifestSchema>
export type SkillExecutionMode = z.infer<typeof SkillExecutionModeSchema>
