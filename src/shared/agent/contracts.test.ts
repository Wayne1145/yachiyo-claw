import { describe, expect, it } from 'vitest'
import {
  AccessibilitySelectorSchema,
  ApprovalDecisionSchema,
  ApprovalPolicySchema,
  AUDIT_EVENTS,
  AuditOutcomeSchema,
  AuditRecordSchema,
  BACKEND_KINDS,
  BackendKindSchema,
  BackgroundGrantSchema,
  ExecutionCheckpointSchema,
  GoalSpecSchema,
  LaunchableAppSchema,
  LauncherPlacementSchema,
  PARAMETER_DIGEST_ALGORITHM,
  RISK_LEVELS,
  RiskLevelSchema,
  SemanticNodeSchema,
  SemanticSnapshotSchema,
  TOOL_IDS,
  ToolCallRequestSchema,
  ToolCallResultSchema,
  ToolDescriptorSchema,
} from '.'

const now = 1_750_000_000_000
const parameterDigest = 'a'.repeat(64)
const parameterBinding = { parameterDigestAlgorithm: PARAMETER_DIGEST_ALGORITHM, parameterDigest } as const
const auditContext = {
  attempt: 1,
  buildFlavor: 'debug',
  brokerVersion: 1,
  policyVersion: 1,
  policyDigest: 'c'.repeat(64),
  backgroundGrantId: null,
  ...parameterBinding,
} as const

const request = {
  schemaVersion: 1,
  taskId: 'task-1',
  stepId: 'step-1',
  callId: 'call-1',
  attempt: 1,
  toolId: TOOL_IDS.SCREEN_OBSERVE,
  toolVersion: 1,
  deadline: now + 30_000,
  parameters: { includeScreenshot: true, formats: ['nodes', 'image'] },
} as const

describe('Agent Tool Broker v1 contracts', () => {
  it('accepts compact accessibility, app index, and checkpoint records', () => {
    const selector = { resourceId: 'com.example:id/follow', role: 'button' } as const
    expect(AccessibilitySelectorSchema.parse(selector)).toEqual(selector)

    const node = {
      nodeId: 'node-1',
      role: 'button',
      text: '关注',
      clickable: true,
      editable: false,
      checked: false,
      selected: false,
      visible: true,
      bounds: { left: 0, top: 0, right: 100, bottom: 80 },
      className: 'android.widget.Button',
      ancestorSignature: 'button#com.example:id/follow',
      sensitive: false,
      index: 0,
    } as const
    expect(SemanticNodeSchema.parse(node)).toEqual(node)
    expect(
      SemanticSnapshotSchema.parse({
        version: 1,
        packageName: 'com.example.app',
        nodes: [node],
        nodeCount: 1,
        truncated: false,
        screenSignature: 'screen-1',
      })
    ).toMatchObject({ nodeCount: 1 })

    const app = {
      packageName: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      launchActivity: 'com.example.app.MainActivity',
      label: 'Example',
      aliases: ['示例'],
      updatedAt: now,
    } as const
    expect(LaunchableAppSchema.parse(app)).toEqual(app)
    expect(
      LaunchableAppSchema.parse({ packageName: 'com.example.other', label: 'Other', versionCode: '42' })
    ).toMatchObject({ packageName: 'com.example.other' })

    const placement = {
      launcherPackage: 'com.android.launcher3',
      launcherVersionCode: '42',
      displayId: '0',
      orientation: 'portrait',
      density: 2.75,
      gridRows: 6,
      gridColumns: 5,
      packageName: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      pageIndex: 1,
      cellRow: 2,
      cellColumn: 3,
      bounds: { left: 0, top: 0, right: 100, bottom: 80 },
      confidence: 0.9,
      observedAt: now,
      label: 'Example',
      screenSignature: 'launcher:page-1',
    } as const
    expect(LauncherPlacementSchema.parse(placement)).toEqual(placement)
    expect(LauncherPlacementSchema.safeParse({ ...placement, cellRow: placement.gridRows }).success).toBe(false)

    const checkpoint = {
      schemaVersion: 1,
      taskId: 'task-1',
      stepId: 'step-1',
      callId: 'call-1',
      attempt: 1,
      toolId: TOOL_IDS.UI_TAP,
      parameterDigest,
      expectedState: { following: true },
      sideEffectState: 'unknown',
      resultDigest: null,
      recordedAt: now,
    } as const
    expect(ExecutionCheckpointSchema.parse(checkpoint)).toEqual(checkpoint)
    expect(
      GoalSpecSchema.parse({
        objective: '在微信发朋友圈',
        constraints: {
          maxLocalActions: 20,
          maxCommits: 1,
          maxModelRequests: 3,
          maxReplans: 1,
          requireVerification: true,
        },
      })
    ).toMatchObject({ objective: '在微信发朋友圈' })
  })

  it('rejects extra fields on descriptors and nested contract objects', () => {
    const descriptor = {
      schemaVersion: 1,
      toolId: TOOL_IDS.UI_TAP,
      version: 1,
      displayName: 'Tap',
      description: 'Tap a visible point on the current screen.',
      parametersSchema: { type: 'object' },
      resultSchema: { type: 'object' },
      modelResultPolicy: { sensitivity: 'private', maxBytes: 65_536, retention: 'ephemeral' },
      riskLevel: 'act',
      approvalPolicy: { mode: 'prompt', scope: 'parameters', rememberFor: 'never' },
      supportedBackends: ['accessibility', 'adb'],
    } as const

    expect(ToolDescriptorSchema.parse(descriptor)).toEqual(descriptor)
    expect(ToolDescriptorSchema.safeParse({ ...descriptor, executable: true }).success).toBe(false)
    expect(
      ToolDescriptorSchema.safeParse({
        ...descriptor,
        approvalPolicy: { ...descriptor.approvalPolicy, bypass: true },
      }).success
    ).toBe(false)
  })

  it('does not let a model choose an execution backend', () => {
    expect(ToolCallRequestSchema.parse(request)).toEqual(request)
    expect(
      ToolCallRequestSchema.safeParse({
        ...request,
        backend: 'root',
      }).success
    ).toBe(false)
  })

  it('parses every backend, risk level, approval policy, and approval decision', () => {
    for (const backend of BACKEND_KINDS) {
      expect(BackendKindSchema.parse(backend)).toBe(backend)
    }
    for (const riskLevel of RISK_LEVELS) {
      expect(RiskLevelSchema.parse(riskLevel)).toBe(riskLevel)
    }

    const policies = [
      { mode: 'none' },
      { mode: 'prompt', scope: 'parameters', rememberFor: 'never' },
      { mode: 'prompt', scope: 'parameters', rememberFor: 'background-grant' },
      { mode: 'blocked', reason: 'This capability is disabled by the user.' },
    ]
    for (const policy of policies) {
      expect(ApprovalPolicySchema.parse(policy)).toEqual(policy)
    }

    const decisions = [
      { status: 'not-required' },
      { status: 'pending', approvalId: 'approval-1', requestedAt: now, ...parameterBinding },
      {
        status: 'approved',
        approvalId: 'approval-1',
        decidedAt: now + 1,
        decidedBy: 'user',
        ...parameterBinding,
      },
      {
        status: 'denied',
        approvalId: 'approval-2',
        decidedAt: now + 2,
        decidedBy: 'policy',
        ...parameterBinding,
        reason: 'Screen is locked.',
      },
    ]
    for (const decision of decisions) {
      expect(ApprovalDecisionSchema.parse(decision)).toEqual(decision)
    }
  })

  it('discriminates successful and failed tool results', () => {
    const envelope = {
      schemaVersion: 1,
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      attempt: request.attempt,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      completedAt: now + 10,
    } as const
    const success = {
      ...envelope,
      status: 'success',
      backend: 'accessibility',
      result: { nodes: [], screenshot: null },
    } as const
    const failure = {
      ...envelope,
      status: 'error',
      backend: null,
      error: {
        code: 'approval_denied',
        message: 'The user denied this action.',
        retryable: false,
      },
    } as const

    expect(ToolCallResultSchema.parse(success)).toEqual(success)
    expect(ToolCallResultSchema.parse(failure)).toEqual(failure)
    expect(ToolCallResultSchema.safeParse({ ...success, error: failure.error }).success).toBe(false)
    expect(ToolCallResultSchema.safeParse({ ...failure, result: null }).success).toBe(false)
    expect(
      ToolCallResultSchema.safeParse({
        ...failure,
        error: { ...failure.error, details: { rawBackendResponse: 'secret' } },
      }).success
    ).toBe(false)
  })

  it('keeps background grants narrow, bounded, and parameter-bound', () => {
    const grant = {
      schemaVersion: 1,
      grantId: 'grant-1',
      taskId: request.taskId,
      scheduleId: 'schedule-1',
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      createdAt: now,
      expiresAt: now + 60_000,
      maxUses: 1,
      usesConsumed: 0,
      deviceLockPolicy: 'unlocked-only',
      ...parameterBinding,
    } as const

    expect(BackgroundGrantSchema.parse(grant)).toEqual(grant)
    expect(BackgroundGrantSchema.safeParse({ ...grant, expiresAt: now }).success).toBe(false)
    expect(BackgroundGrantSchema.safeParse({ ...grant, maxUses: 0 }).success).toBe(false)
    expect(BackgroundGrantSchema.safeParse({ ...grant, usesConsumed: 2 }).success).toBe(false)
    expect(BackgroundGrantSchema.safeParse({ ...grant, backend: 'root' }).success).toBe(false)
  })

  it('keeps audit records strict and Broker-owned', () => {
    const record = {
      schemaVersion: 1,
      auditId: 'audit-1',
      recordedAt: now,
      event: 'request-received',
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      ...auditContext,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      riskLevel: 'read',
      approvalPolicy: { mode: 'none' },
      approvalDecision: { status: 'not-required' },
      backend: null,
      outcome: null,
    } as const

    expect(AuditRecordSchema.parse(record)).toEqual(record)
    expect(AuditRecordSchema.safeParse({ ...record, modelSelectedBackend: 'root' }).success).toBe(false)
    expect(AuditRecordSchema.safeParse({ ...record, parameters: request.parameters }).success).toBe(false)
    expect(AuditRecordSchema.safeParse({ ...record, result: { screenshot: 'raw-image-data' } }).success).toBe(false)

    expect(AUDIT_EVENTS).toContain('request-rejected')
    expect(AUDIT_EVENTS).toContain('execution-cancelled')
  })

  it('excludes free-text approval reasons from persisted audit records', () => {
    const baseRecord = {
      schemaVersion: 1,
      auditId: 'audit-minimal',
      recordedAt: now,
      event: 'request-rejected',
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      ...auditContext,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      riskLevel: 'sensitive',
      approvalPolicy: { mode: 'blocked' },
      approvalDecision: {
        status: 'denied',
        approvalId: 'approval-secret',
        decidedAt: now,
        decidedBy: 'policy',
        ...parameterBinding,
      },
      backend: null,
      outcome: { status: 'error', code: 'policy_blocked', retryable: false },
    } as const

    expect(AuditRecordSchema.parse(baseRecord)).toEqual(baseRecord)
    expect(
      AuditRecordSchema.safeParse({
        ...baseRecord,
        approvalPolicy: { mode: 'blocked', reason: 'Typed secret: sk-private' },
      }).success
    ).toBe(false)
    expect(
      AuditRecordSchema.safeParse({
        ...baseRecord,
        approvalDecision: { ...baseRecord.approvalDecision, reason: 'Screen text with a password' },
      }).success
    ).toBe(false)
  })

  it('rejects impossible audit event, backend, and outcome combinations', () => {
    const record = {
      schemaVersion: 1,
      auditId: 'audit-invalid-state',
      recordedAt: now,
      event: 'request-rejected',
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      ...auditContext,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      riskLevel: 'read',
      approvalPolicy: { mode: 'none' },
      approvalDecision: { status: 'not-required' },
      backend: 'root',
      outcome: { status: 'success', resultDigest: 'b'.repeat(64) },
    } as const

    expect(AuditRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects approval decisions bound to different parameters or grants', () => {
    const approved = {
      status: 'approved',
      approvalId: 'approval-bound',
      decidedAt: now,
      decidedBy: 'policy',
      grantId: 'grant-bound',
      ...parameterBinding,
    } as const
    const record = {
      schemaVersion: 1,
      auditId: 'audit-bound',
      recordedAt: now,
      event: 'execution-started',
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      ...auditContext,
      backgroundGrantId: 'grant-bound',
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      riskLevel: 'act',
      approvalPolicy: { mode: 'prompt', scope: 'parameters', rememberFor: 'background-grant' },
      approvalDecision: approved,
      backend: 'accessibility',
      outcome: null,
    } as const

    expect(AuditRecordSchema.safeParse(record).success).toBe(true)
    expect(
      AuditRecordSchema.safeParse({
        ...record,
        approvalDecision: { ...approved, parameterDigest: 'b'.repeat(64) },
      }).success
    ).toBe(false)
    expect(AuditRecordSchema.safeParse({ ...record, backgroundGrantId: 'grant-other' }).success).toBe(false)
  })

  it('accepts coherent records for each audited lifecycle transition', () => {
    const base = {
      schemaVersion: 1,
      auditId: 'audit-lifecycle',
      recordedAt: now,
      taskId: request.taskId,
      stepId: request.stepId,
      callId: request.callId,
      ...auditContext,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      riskLevel: 'act',
      approvalPolicy: { mode: 'prompt', scope: 'parameters', rememberFor: 'never' },
    } as const
    const pending = {
      status: 'pending',
      approvalId: 'approval-lifecycle',
      requestedAt: now,
      ...parameterBinding,
    } as const
    const approved = {
      status: 'approved',
      approvalId: 'approval-lifecycle',
      decidedAt: now + 1,
      decidedBy: 'user',
      ...parameterBinding,
    } as const
    const errorOutcome = { status: 'error', code: 'cancelled', retryable: false } as const

    const records = [
      { ...base, event: 'approval-requested', approvalDecision: pending, backend: null, outcome: null },
      { ...base, event: 'approval-resolved', approvalDecision: approved, backend: null, outcome: null },
      { ...base, event: 'execution-started', approvalDecision: approved, backend: 'accessibility', outcome: null },
      {
        ...base,
        event: 'execution-finished',
        approvalDecision: approved,
        backend: 'accessibility',
        outcome: { status: 'success', resultDigest: 'b'.repeat(64) },
      },
      {
        ...base,
        event: 'execution-cancelled',
        approvalDecision: approved,
        backend: 'accessibility',
        outcome: errorOutcome,
      },
    ]

    for (const record of records) {
      expect(AuditRecordSchema.safeParse(record).success).toBe(true)
    }
  })

  it('stores only digests or minimal error metadata in audit outcomes', () => {
    const success = { status: 'success', resultDigest: 'b'.repeat(64) }
    const error = { status: 'error', code: 'backend_disconnected', retryable: true }

    expect(AuditOutcomeSchema.parse(success)).toEqual(success)
    expect(AuditOutcomeSchema.parse(error)).toEqual(error)
    expect(
      AuditOutcomeSchema.safeParse({
        ...success,
        result: { screenshot: 'raw-image-data' },
      }).success
    ).toBe(false)
    expect(
      AuditOutcomeSchema.safeParse({
        ...error,
        message: 'Sensitive input was rejected.',
        details: { input: 'secret' },
      }).success
    ).toBe(false)
  })
})
