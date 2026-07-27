import { z } from 'zod'
import { SkillSignatureSchema } from '../types/skills'
import { PLUGIN_PACKAGE_LIMITS } from './package'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i)
const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS is required')

export const PluginMarketplaceEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    version: z.string().trim().min(1).max(64),
    packageUrl: HttpsUrlSchema,
    packageSize: z.number().int().positive().max(PLUGIN_PACKAGE_LIMITS.maxArchiveBytes),
    sha256: Sha256Schema,
    signature: SkillSignatureSchema,
    repository: HttpsUrlSchema.optional(),
  })
  .strict()

export const PluginMarketplaceCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    plugins: z.array(PluginMarketplaceEntrySchema).max(500),
  })
  .strict()

export type PluginMarketplaceEntry = z.infer<typeof PluginMarketplaceEntrySchema>

export function parsePluginMarketplaceCatalog(value: unknown): { schemaVersion: 1; plugins: PluginMarketplaceEntry[] } {
  return PluginMarketplaceCatalogSchema.parse(value)
}
