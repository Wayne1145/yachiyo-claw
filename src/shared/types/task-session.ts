import { z } from 'zod'
import { CompactionPointSchema, MessageSchema } from './session'
import { SessionSettingsSchema } from './settings'

export const TaskSessionSchema = z.object({
  id: z.string(),
  linkedSessionId: z.string().optional(),
  name: z.string(),
  workingDirectory: z.string(),
  messages: z.array(MessageSchema),
  settings: SessionSettingsSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  compactionPoints: z.array(CompactionPointSchema).optional(),
})
export type TaskSession = z.infer<typeof TaskSessionSchema>

export const TaskSessionPageSchema = z.object({
  items: z.array(TaskSessionSchema),
  nextCursor: z.number().nullable(),
  total: z.number(),
})
export type TaskSessionPage = z.infer<typeof TaskSessionPageSchema>
