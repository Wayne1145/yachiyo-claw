import { z } from 'zod'

export const TOOL_PROTOCOL_VERSION = 1 as const
export const PARAMETER_DIGEST_ALGORITHM = 'sha256-rfc8785' as const

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** JSON-only values keep the bridge contract portable between TypeScript and Kotlin. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)

const SchemaVersionSchema = z.literal(TOOL_PROTOCOL_VERSION)
const IdentifierSchema = z.string().trim().min(1).max(128)
const ToolIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'Tool IDs must be lowercase and namespaced')
const TimestampMsSchema = z.number().int().nonnegative()
const ParameterDigestSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest')
const ParameterBindingShape = {
  parameterDigestAlgorithm: z.literal(PARAMETER_DIGEST_ALGORITHM),
  parameterDigest: ParameterDigestSchema,
}

export const BACKEND_KINDS = ['standard', 'accessibility', 'adb', 'shizuku', 'root'] as const
export const BackendKindSchema = z.enum(BACKEND_KINDS)
export type BackendKind = z.infer<typeof BackendKindSchema>

export const RISK_LEVELS = ['read', 'act', 'sensitive', 'destructive'] as const
export const RiskLevelSchema = z.enum(RISK_LEVELS)
export type RiskLevel = z.infer<typeof RiskLevelSchema>

const NoApprovalPolicySchema = z
  .object({
    mode: z.literal('none'),
  })
  .strict()

const PromptApprovalPolicySchema = z
  .object({
    mode: z.literal('prompt'),
    scope: z.enum(['call', 'parameters']),
    rememberFor: z.enum(['never', 'task', 'background-grant']),
  })
  .strict()

const BlockedApprovalPolicySchema = z
  .object({
    mode: z.literal('blocked'),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

export const ApprovalPolicySchema = z.discriminatedUnion('mode', [
  NoApprovalPolicySchema,
  PromptApprovalPolicySchema,
  BlockedApprovalPolicySchema,
])
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

const ApprovalNotRequiredSchema = z
  .object({
    status: z.literal('not-required'),
  })
  .strict()

const ApprovalPendingSchema = z
  .object({
    status: z.literal('pending'),
    approvalId: IdentifierSchema,
    requestedAt: TimestampMsSchema,
    ...ParameterBindingShape,
  })
  .strict()

const ApprovalApprovedSchema = z
  .object({
    status: z.literal('approved'),
    approvalId: IdentifierSchema,
    decidedAt: TimestampMsSchema,
    decidedBy: z.enum(['user', 'policy']),
    grantId: IdentifierSchema.optional(),
    ...ParameterBindingShape,
  })
  .strict()

const ApprovalDeniedSchema = z
  .object({
    status: z.literal('denied'),
    approvalId: IdentifierSchema,
    decidedAt: TimestampMsSchema,
    decidedBy: z.enum(['user', 'policy']),
    ...ParameterBindingShape,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export const ApprovalDecisionSchema = z.discriminatedUnion('status', [
  ApprovalNotRequiredSchema,
  ApprovalPendingSchema,
  ApprovalApprovedSchema,
  ApprovalDeniedSchema,
])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

/** A user-created background grant is narrow, bounded, and never grants a model backend choice. */
export const BackgroundGrantSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    grantId: IdentifierSchema,
    taskId: IdentifierSchema,
    scheduleId: IdentifierSchema,
    toolId: ToolIdSchema,
    toolVersion: z.number().int().positive(),
    createdAt: TimestampMsSchema,
    expiresAt: TimestampMsSchema,
    maxUses: z.number().int().positive().max(10_000),
    usesConsumed: z.number().int().nonnegative(),
    deviceLockPolicy: z.enum(['unlocked-only', 'allow-locked']),
    ...ParameterBindingShape,
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.expiresAt <= grant.createdAt) {
      context.addIssue({ code: 'custom', message: 'A background grant must expire after it is created.' })
    }
    if (grant.usesConsumed > grant.maxUses) {
      context.addIssue({ code: 'custom', message: 'A background grant cannot consume more than its maximum uses.' })
    }
  })
export type BackgroundGrant = z.infer<typeof BackgroundGrantSchema>

// Audit projections keep policy codes while excluding user-facing reason text.
export const AuditApprovalPolicySchema = z.discriminatedUnion('mode', [
  NoApprovalPolicySchema,
  PromptApprovalPolicySchema,
  z.object({ mode: z.literal('blocked') }).strict(),
])
export type AuditApprovalPolicy = z.infer<typeof AuditApprovalPolicySchema>

export const AuditApprovalDecisionSchema = z.discriminatedUnion('status', [
  ApprovalNotRequiredSchema,
  ApprovalPendingSchema,
  ApprovalApprovedSchema,
  z
    .object({
      status: z.literal('denied'),
      approvalId: IdentifierSchema,
      decidedAt: TimestampMsSchema,
      decidedBy: z.enum(['user', 'policy']),
      ...ParameterBindingShape,
    })
    .strict(),
])
export type AuditApprovalDecision = z.infer<typeof AuditApprovalDecisionSchema>

export const ModelResultPolicySchema = z
  .object({
    sensitivity: z.enum(['public', 'private', 'sensitive']),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
    retention: z.enum(['ephemeral', 'task']),
  })
  .strict()
export type ModelResultPolicy = z.infer<typeof ModelResultPolicySchema>

export const ToolDescriptorSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    toolId: ToolIdSchema,
    version: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2_000),
    parametersSchema: JsonValueSchema,
    resultSchema: JsonValueSchema,
    modelResultPolicy: ModelResultPolicySchema,
    riskLevel: RiskLevelSchema,
    approvalPolicy: ApprovalPolicySchema,
    supportedBackends: z.array(BackendKindSchema).min(1),
  })
  .strict()
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>

export const ToolCallRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    taskId: IdentifierSchema,
    stepId: IdentifierSchema,
    /** Persisted idempotency key. A Broker must not commit a side effect twice for one callId. */
    callId: IdentifierSchema,
    /** Starts at one and increments only when the persisted call is deliberately retried or recovered. */
    attempt: z.number().int().positive(),
    toolId: ToolIdSchema,
    toolVersion: z.number().int().positive(),
    /** Absolute Unix time in milliseconds. The Broker must not start a call after this deadline. */
    deadline: TimestampMsSchema,
    parameters: JsonValueSchema,
  })
  .strict()
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>

export const ToolErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict()
export type ToolError = z.infer<typeof ToolErrorSchema>

const ToolResultEnvelopeShape = {
  schemaVersion: SchemaVersionSchema,
  taskId: IdentifierSchema,
  stepId: IdentifierSchema,
  callId: IdentifierSchema,
  attempt: z.number().int().positive(),
  toolId: ToolIdSchema,
  toolVersion: z.number().int().positive(),
  completedAt: TimestampMsSchema,
}

export const ToolCallSuccessSchema = z
  .object({
    ...ToolResultEnvelopeShape,
    status: z.literal('success'),
    backend: BackendKindSchema,
    /** This is the bounded, redacted model-safe projection, never the raw backend result. */
    result: JsonValueSchema,
  })
  .strict()

export const ToolCallFailureSchema = z
  .object({
    ...ToolResultEnvelopeShape,
    status: z.literal('error'),
    // Null means the Broker rejected the call before selecting an execution backend.
    backend: BackendKindSchema.nullable(),
    error: ToolErrorSchema,
  })
  .strict()

export const ToolCallResultSchema = z.discriminatedUnion('status', [ToolCallSuccessSchema, ToolCallFailureSchema])
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>

export const AUDIT_EVENTS = [
  'request-received',
  'request-rejected',
  'approval-requested',
  'approval-resolved',
  'execution-started',
  'execution-finished',
  'execution-cancelled',
] as const

const AuditSuccessOutcomeSchema = z
  .object({
    status: z.literal('success'),
    resultDigest: ParameterDigestSchema,
  })
  .strict()

const AuditErrorOutcomeSchema = z
  .object({
    status: z.literal('error'),
    code: z.string().trim().min(1).max(100),
    retryable: z.boolean(),
  })
  .strict()

/** Persisted outcome metadata deliberately excludes tool output and human-readable error data. */
export const AuditOutcomeSchema = z.discriminatedUnion('status', [AuditSuccessOutcomeSchema, AuditErrorOutcomeSchema])
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>

export const AuditRecordSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    auditId: IdentifierSchema,
    recordedAt: TimestampMsSchema,
    event: z.enum(AUDIT_EVENTS),
    taskId: IdentifierSchema,
    stepId: IdentifierSchema,
    callId: IdentifierSchema,
    attempt: z.number().int().positive(),
    toolId: ToolIdSchema,
    toolVersion: z.number().int().positive(),
    buildFlavor: z.enum(['debug', 'sideload', 'store']),
    brokerVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    policyDigest: ParameterDigestSchema,
    riskLevel: RiskLevelSchema,
    approvalPolicy: AuditApprovalPolicySchema,
    approvalDecision: AuditApprovalDecisionSchema,
    /** References a separately persisted, bounded BackgroundGrant when policy approved the call. */
    backgroundGrantId: IdentifierSchema.nullable(),
    /** Set only by the Broker. Null records a call that never reached backend selection. */
    backend: BackendKindSchema.nullable(),
    ...ParameterBindingShape,
    /** Null means the call has not reached a terminal outcome. */
    outcome: AuditOutcomeSchema.nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const reject = (message: string) => context.addIssue({ code: 'custom', message })
    const decision = record.approvalDecision

    if ('parameterDigest' in decision) {
      if (
        decision.parameterDigest !== record.parameterDigest ||
        decision.parameterDigestAlgorithm !== record.parameterDigestAlgorithm
      ) {
        reject('The approval decision must bind to the audited canonical parameter digest.')
      }
    }

    if (decision.status === 'approved') {
      if ((decision.grantId ?? null) !== record.backgroundGrantId) {
        reject('The approved grant reference must match the audited background grant.')
      }
    } else if (record.backgroundGrantId !== null) {
      reject('Only an approved decision may reference a background grant.')
    }

    switch (record.event) {
      case 'request-received':
        if (record.backend !== null || record.outcome !== null) {
          reject('A received request cannot have a backend or terminal outcome.')
        }
        break
      case 'request-rejected':
        if (record.backend !== null || record.outcome?.status !== 'error') {
          reject('A rejected request must have no backend and an error outcome.')
        }
        break
      case 'approval-requested':
        if (record.backend !== null || record.outcome !== null || record.approvalDecision.status !== 'pending') {
          reject('An approval request must be pending and have no backend or outcome.')
        }
        break
      case 'approval-resolved':
        if (record.backend !== null || !['approved', 'denied'].includes(record.approvalDecision.status)) {
          reject('A resolved approval must be approved or denied before backend selection.')
        }
        if (record.approvalDecision.status === 'approved' && record.outcome !== null) {
          reject('An approved decision is not a terminal tool outcome.')
        }
        if (record.approvalDecision.status === 'denied' && record.outcome?.status !== 'error') {
          reject('A denied decision must have an error outcome.')
        }
        break
      case 'execution-started':
        if (
          record.backend === null ||
          record.outcome !== null ||
          !['not-required', 'approved'].includes(record.approvalDecision.status)
        ) {
          reject('Execution can start only with a backend and a satisfied approval decision.')
        }
        break
      case 'execution-finished':
        if (
          record.backend === null ||
          record.outcome === null ||
          !['not-required', 'approved'].includes(record.approvalDecision.status)
        ) {
          reject('Finished execution requires a backend, outcome, and satisfied approval decision.')
        }
        break
      case 'execution-cancelled':
        if (record.outcome?.status !== 'error') {
          reject('Cancelled execution must have an error outcome.')
        }
        break
    }
  })
export type AuditRecord = z.infer<typeof AuditRecordSchema>
