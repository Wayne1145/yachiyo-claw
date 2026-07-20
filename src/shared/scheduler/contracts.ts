export const SCHEDULER_SCHEMA_VERSION = 1 as const

export type ScheduleRepeat = 'once' | 'daily' | 'weekly'

export type ScheduleStatus =
  | 'scheduled'
  | 'claimed'
  | 'running'
  | 'paused'
  | 'awaiting-approval'
  | 'awaiting-foreground'
  | 'succeeded'
  | 'retryable-failed'
  | 'permanent-failed'
  | 'cancelled'

export interface ScheduleSpec {
  id?: string
  title: string
  prompt: string
  runAt: number
  repeat: ScheduleRepeat
  enabled?: boolean
  exact?: boolean
  requiresNetwork?: boolean
  timezone?: string
}

export interface ScheduleRecord extends Omit<Required<ScheduleSpec>, 'id'> {
  id: string
  schemaVersion: typeof SCHEDULER_SCHEMA_VERSION
  status: ScheduleStatus
  nextRunAt: number
  currentExecutionId: string
  createdAt: number
  updatedAt: number
}

export interface ScheduleExecution {
  id: string
  scheduleId: string
  status: ScheduleStatus
  attempt: number
  scheduledAt: number
  claimedAt: number
  leaseExpiresAt: number
  startedAt: number
  finishedAt: number
  lastError?: string
  checkpoint?: string
}

export interface RuntimeCheckpoint {
  version: 1
  scheduleId: string
  executionId: string
  stepId: string
  callId: string
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown'
  updatedAt: number
  outputDigest?: string
}

export interface ScheduleOutboxEvent {
  schemaVersion: typeof SCHEDULER_SCHEMA_VERSION
  eventType: 'schedule_wake' | 'schedule_failed'
  scheduleId: string
  executionId: string
  deliveryId: string
  deliveryToken: string
  title: string
  prompt: string
  repeat: ScheduleRepeat
  enabled: boolean
  timezone: string
  runAt: number
  status: ScheduleStatus
  attempt: number
  headlessPending: boolean
}

export interface BackgroundGrant {
  id: string
  scheduleId: string
  capability: string
  expiresAt?: number
  requiresForegroundApproval: boolean
}

export interface AuditRecord {
  id: string
  scheduleId?: string
  executionId?: string
  action: string
  outcome: 'allowed' | 'denied' | 'pending' | 'failed'
  createdAt: number
  parameterDigest?: string
}

export interface SchedulerListResult {
  schemaVersion: typeof SCHEDULER_SCHEMA_VERSION
  schedules: ScheduleRecord[]
  headlessExecution: false
  pendingState: 'awaiting-foreground'
}

export interface SchedulerCapabilities {
  schemaVersion: typeof SCHEDULER_SCHEMA_VERSION
  workManager: true
  roomStore: true
  headlessExecution: false
  foregroundDrain: true
  forceStopRecovery: false
  pendingState: 'awaiting-foreground'
}

export interface SchedulerAcknowledgeInput {
  deliveryId?: string
  deliveryToken?: string
  scheduleId: string
  executionId: string
  status: Extract<
    ScheduleStatus,
    'succeeded' | 'paused' | 'awaiting-approval' | 'retryable-failed' | 'permanent-failed' | 'cancelled'
  >
  error?: string
  checkpoint?: string
  result?: string
}

export interface ScheduleBeginForegroundInput {
  deliveryId: string
  deliveryToken: string
  scheduleId: string
  executionId: string
  checkpoint: string
}

const REPEATS: readonly ScheduleRepeat[] = ['once', 'daily', 'weekly']

export function isScheduleRepeat(value: unknown): value is ScheduleRepeat {
  return typeof value === 'string' && REPEATS.includes(value as ScheduleRepeat)
}

export function normalizeScheduleSpec(input: ScheduleSpec): Required<ScheduleSpec> {
  const title = input.title.trim()
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('task_prompt_required')
  if (!Number.isFinite(input.runAt) || input.runAt < 0) throw new Error('task_run_time_invalid')
  if (!isScheduleRepeat(input.repeat)) throw new Error('task_repeat_invalid')
  return {
    id: input.id?.trim() || '',
    title: title || prompt.slice(0, 24),
    prompt,
    runAt: input.runAt,
    repeat: input.repeat,
    enabled: input.enabled ?? true,
    exact: input.exact ?? false,
    requiresNetwork: input.requiresNetwork ?? false,
    timezone: input.timezone?.trim() || 'UTC',
  }
}

export function nextScheduleRunAt(repeat: ScheduleRepeat, previousRunAt: number, now: number): number {
  if (repeat === 'once') return previousRunAt
  const interval = repeat === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  let next = previousRunAt + interval
  while (next <= now) next += interval
  return next
}

export function isTerminalScheduleStatus(status: ScheduleStatus): boolean {
  return status === 'succeeded' || status === 'permanent-failed' || status === 'cancelled'
}

const TRANSITIONS: Record<ScheduleStatus, readonly ScheduleStatus[]> = {
  scheduled: ['claimed', 'cancelled'],
  claimed: ['running', 'awaiting-foreground', 'retryable-failed', 'permanent-failed', 'cancelled'],
  running: [
    'paused',
    'awaiting-approval',
    'awaiting-foreground',
    'succeeded',
    'retryable-failed',
    'permanent-failed',
    'cancelled',
  ],
  paused: ['scheduled', 'running', 'cancelled'],
  'awaiting-approval': ['running', 'paused', 'cancelled'],
  'awaiting-foreground': ['running', 'succeeded', 'retryable-failed', 'permanent-failed', 'cancelled'],
  succeeded: [],
  'retryable-failed': ['claimed', 'scheduled', 'permanent-failed', 'cancelled'],
  'permanent-failed': [],
  cancelled: [],
}

export function canTransitionScheduleStatus(from: ScheduleStatus, to: ScheduleStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

