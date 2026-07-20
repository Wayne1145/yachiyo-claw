import { z } from 'zod'

export const WorkspacePlanStateSchema = z.enum([
  'draft',
  'inspecting',
  'awaiting-approval',
  'applying',
  'testing',
  'completed',
  'paused',
  'failed',
  'cancelled',
])
export type WorkspacePlanState = z.infer<typeof WorkspacePlanStateSchema>

export const WorkspaceRootSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(4_096),
    platform: z.enum(['desktop', 'android-saf', 'android-private']),
  })
  .strict()
export type WorkspaceRoot = z.infer<typeof WorkspaceRootSchema>

export const WorkspacePatchOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      path: z.string().trim().min(1).max(2_048),
      content: z.string().max(2_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update'),
      path: z.string().trim().min(1).max(2_048),
      search: z.string().min(1).max(2_000_000),
      replace: z.string().max(2_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete'),
      path: z.string().trim().min(1).max(2_048),
    })
    .strict(),
])
export type WorkspacePatchOperation = z.infer<typeof WorkspacePatchOperationSchema>

export const WorkspaceAgentPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(128),
    objective: z.string().trim().min(1).max(6_000),
    root: WorkspaceRootSchema,
    state: WorkspacePlanStateSchema,
    operations: z.array(WorkspacePatchOperationSchema).max(200),
    testCommands: z.array(z.string().trim().min(1).max(2_000)).max(20),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    checkpoint: z.number().int().nonnegative(),
    commitRequested: z.boolean(),
  })
  .strict()
export type WorkspaceAgentPlan = z.infer<typeof WorkspaceAgentPlanSchema>

export function validateWorkspaceRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('workspace_path_must_be_relative')
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('workspace_path_traversal')
  }
  if (normalized.includes('\0') || normalized.length > 2_048) throw new Error('workspace_path_invalid')
  return segments.join('/')
}

export function validateWorkspacePatch(operation: WorkspacePatchOperation): WorkspacePatchOperation {
  const parsed = WorkspacePatchOperationSchema.parse(operation)
  validateWorkspaceRelativePath(parsed.path)
  if ('content' in parsed && parsed.content.length > 2_000_000) throw new Error('workspace_file_too_large')
  return parsed
}

