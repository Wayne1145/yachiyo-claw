import {
  AgentPrincipalSchema,
  CORE_AGENT_PRINCIPAL,
  type AgentPrincipal,
  type JsonValue,
  TOOL_IDS,
  ToolCallRequestSchema,
  type ToolId,
} from '@shared/agent'
import { type RootCommandResult, yachiyoAgentNative } from '@/platform/native/yachiyo_agent'
import { createFeatureLocalStore } from '@/features/feature-settings'
import {
  type BrokerToolId,
  registerCompanionBrokerTool,
  requireBrokerToolAuthorization,
} from '@/features/broker-tool-registry'
import {
  type AccessibilityActionOptions,
  type AccessibilityActionResult,
  yachiyoDeviceAccessNative,
} from '@/platform/native/yachiyo_device_access'
import { type AgentCheckpointStorage, AgentCheckpointStore } from './agent-checkpoints'
import type { AndroidCanonicalCapability, AndroidCompanionRegistry, AndroidControlResult } from './android-companion'

const FULL_ACCESS_KEY = 'yachiyo-agent-full-access-v1'
const AUDIT_KEY = 'yachiyo-agent-audit-v1'
const WORKING_DIRECTORY_KEY = 'yachiyo-agent-working-directory-v1'
const BACKEND_KEY = 'yachiyo-agent-backend-v1'
const ROOT_CAPABILITY_KEY = 'yachiyo-agent-root-capability-v1'
const agentLocalStore = createFeatureLocalStore('android-device')

export const ANDROID_AGENT_WORKING_DIRECTORY = '/data/local/tmp/yachiyo-agent'
export type AgentBackend = 'root' | 'shizuku' | 'accessibility'
export type AgentExecutionBackend = AgentBackend | 'adb' | 'companion' | 'sandbox' | 'standard'
export interface RootCapability {
  available: boolean
  detail: string
}

let rootCapabilityCache: RootCapability | null = null
let companionRegistry: AndroidCompanionRegistry | null = null

function readMigratedLocalValue<T>(
  name: string,
  legacyKey: string,
  fallback: T,
  parseLegacy: (raw: string) => T | undefined,
): T {
  if (agentLocalStore.has(name)) return agentLocalStore.get(name, fallback)
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(legacyKey)
    if (raw === null) return fallback
    const parsed = parseLegacy(raw)
    if (parsed === undefined) return fallback
    agentLocalStore.set(name, parsed)
    return parsed
  } catch {
    return fallback
  }
}

/** Configure the optional companion transport without making it the default backend. */
export function setAndroidCompanionRegistry(registry: AndroidCompanionRegistry | null): void {
  companionRegistry = registry
}

export function getAndroidCompanionRegistry(): AndroidCompanionRegistry | null {
  return companionRegistry
}

function readPersistedRootCapability(): RootCapability | null {
  return readMigratedLocalValue('root-capability', ROOT_CAPABILITY_KEY, null, (raw) => {
    try {
      const parsed = JSON.parse(raw) as RootCapability | null
      return parsed && typeof parsed.available === 'boolean' && typeof parsed.detail === 'string' ? parsed : undefined
    } catch {
      return undefined
    }
  })
}

function persistRootCapability(capability: RootCapability | null): void {
  rootCapabilityCache = capability
  if (capability) agentLocalStore.set('root-capability', capability)
  else agentLocalStore.remove('root-capability')
}

export function getAgentBackend(): AgentBackend {
  return readMigratedLocalValue('backend', BACKEND_KEY, 'root' as AgentBackend, (raw) =>
    raw === 'root' || raw === 'shizuku' || raw === 'accessibility' ? raw : undefined,
  )
}

export function setAgentBackend(backend: AgentBackend): void {
  agentLocalStore.set('backend', backend)
}

export function getAgentWorkingDirectory(): string {
  return readMigratedLocalValue('working-directory', WORKING_DIRECTORY_KEY, ANDROID_AGENT_WORKING_DIRECTORY, (raw) => {
    const value = raw.trim()
    return value.startsWith('/') && !/[\0\r\n]/.test(value) ? value : undefined
  })
}

export function setAgentWorkingDirectory(path: string): void {
  const normalized = path.trim().replace(/\/+$/, '')
  if (!normalized.startsWith('/') || /[\0\r\n]/.test(normalized)) {
    throw new Error('invalid_working_directory')
  }
  agentLocalStore.set('working-directory', normalized)
}

export interface AgentAuditEntry {
  at: number
  callId: string
  toolId: string
  principal: AgentPrincipal
  backend: AgentExecutionBackend | null
  parameterDigest: string
  approvalDecision: 'once' | 'conversation' | 'deny' | 'not-required'
  status: 'success' | 'error' | 'denied' | 'cancelled'
  exitCode?: number
  errorCode?: string
}

const AUDIT_MAX_ENTRIES = 1_000

export function isAgentFullAccessEnabled(): boolean {
  return readMigratedLocalValue('full-access', FULL_ACCESS_KEY, false, (raw) =>
    raw === 'true' ? true : raw === 'false' ? false : undefined,
  )
}

export function setAgentFullAccessEnabled(enabled: boolean): void {
  agentLocalStore.set('full-access', enabled)
}

export function appendAgentAudit(entry: AgentAuditEntry): void {
  const entries = readMigratedLocalValue('audit', AUDIT_KEY, [] as AgentAuditEntry[], (raw) => {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AgentAuditEntry[]) : undefined
    } catch {
      return undefined
    }
  })
  agentLocalStore.set('audit', [...entries.slice(-(AUDIT_MAX_ENTRIES - 1)), entry])
}

export function readAgentAudit(options: { pluginId?: string; limit?: number } = {}): AgentAuditEntry[] {
  try {
    const entries = readMigratedLocalValue('audit', AUDIT_KEY, [] as AgentAuditEntry[], (raw) => {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AgentAuditEntry[]) : undefined
    })
    const filtered = options.pluginId
      ? entries.filter(
          (entry) => entry.principal?.kind === 'plugin' && entry.principal.pluginId === options.pluginId,
        )
      : entries
    return filtered.slice(-Math.max(1, Math.min(options.limit ?? 100, 500))).reverse()
  } catch {
    return []
  }
}

export interface AgentBrokerCallContext {
  taskId?: string
  stepId?: string
  callId?: string
  toolCallId?: string
  attempt?: number
  deadline?: number
  abortSignal?: AbortSignal
  principal?: AgentPrincipal
  approvalDecision?: AgentExecutionOptions<unknown>['approvalDecision']
  /** Read-only shell probes must not be treated as a committed side effect. */
  sideEffect?: boolean
}

export class AgentActionAlreadyAppliedError extends Error {
  constructor(public readonly callId: string) {
    super('agent_action_already_applied')
    this.name = 'AgentActionAlreadyAppliedError'
  }
}

export class AgentActionRecoveryRequiredError extends Error {
  constructor(
    public readonly callId: string,
    public readonly state: 'running' | 'unknown',
  ) {
    super('agent_action_recovery_required')
    this.name = 'AgentActionRecoveryRequiredError'
  }
}

function createAgentId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

/** A deterministic JSON representation used for the parameter digest contract. */
export function canonicalAgentJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid_agent_json_number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalAgentJson(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalAgentJson(value[key])}`).join(',')}}`
}

export async function digestAgentJson(value: JsonValue): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('agent_digest_unavailable')
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalAgentJson(value)))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toAgentJson(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (depth >= 4) return String(value)
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => toAgentJson(item, depth + 1))
  if (typeof value === 'object') {
    const record: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value as Record<string, unknown>)
      .sort()
      .slice(0, 128)) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) record[key] = toAgentJson(entry, depth + 1)
    }
    return record
  }
  return String(value)
}

function brokerErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return /^[a-z0-9._:-]{1,100}$/i.test(value) ? value : 'agent_action_failed'
}

async function runAbortableBrokerCall<T>(
  execute: () => Promise<T>,
  signal: AbortSignal | undefined,
  deadline: number,
  onAbort: AgentExecutionOptions<T>['onAbort'],
): Promise<T> {
  if (signal?.aborted) throw new Error('agent_action_cancelled')
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('agent_action_deadline_exceeded')

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      callback()
    }
    const stopBackend = () => {
      try {
        void Promise.resolve(onAbort?.()).catch(() => undefined)
      } catch {
        // Cancellation still wins even if the backend-specific stop hook fails.
      }
    }
    const cancel = () => {
      stopBackend()
      finish(() => reject(new Error('agent_action_cancelled')))
    }
    const timer = setTimeout(() => {
      stopBackend()
      finish(() => reject(new Error('agent_action_deadline_exceeded')))
    }, remaining)
    signal?.addEventListener('abort', cancel, { once: true })
    Promise.resolve()
      .then(execute)
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      )
  })
}

export interface AgentExecutionOptions<T> {
  featureId: string
  principal: AgentPrincipal
  toolId: BrokerToolId
  backend: AgentExecutionBackend
  parameters: JsonValue
  execute: () => Promise<T>
  taskId?: string
  stepId?: string
  callId?: string
  toolCallId?: string
  attempt?: number
  deadline?: number
  expectedState?: JsonValue
  sideEffect?: boolean
  /** When true, an applied/verified call with the same task and digest is reused even with a new call id. */
  dedupeByParameters?: boolean
  /** State to persist when a side-effecting backend explicitly reports failure. */
  failureState?: 'not_started' | 'unknown'
  isSuccess?: (result: T) => boolean
  verify?: (result: T) => Promise<boolean> | boolean
  resultToJson?: (result: T) => JsonValue
  checkpointStore?: AgentCheckpointStore
  abortSignal?: AbortSignal
  approvalDecision?: 'once' | 'conversation' | 'deny' | 'not-required'
  /** Stops a backend process when cancellation or the call deadline wins the race. */
  onAbort?: () => void | Promise<void>
}

let defaultCheckpointStore: AgentCheckpointStore | null = null
const actionLocks = new Map<string, Promise<unknown>>()

export function getAgentCheckpointStore(storage?: AgentCheckpointStorage): AgentCheckpointStore {
  if (storage) return new AgentCheckpointStore({ storage })
  if (!defaultCheckpointStore) defaultCheckpointStore = new AgentCheckpointStore()
  return defaultCheckpointStore
}

function checkpointRecordBase(
  request: {
    taskId: string
    stepId: string
    callId: string
    attempt: number
    toolId: string
    backend: AgentExecutionBackend
  },
  parameterDigest: string,
  expectedState: JsonValue,
  sideEffectState: 'not_started' | 'running' | 'applied' | 'verified' | 'unknown',
  resultDigest: string | null,
) {
  return {
    schemaVersion: 1 as const,
    taskId: request.taskId,
    stepId: request.stepId,
    callId: request.callId,
    attempt: request.attempt,
    toolId: request.toolId,
    backend: request.backend,
    parameterDigest,
    expectedState,
    sideEffectState,
    resultDigest,
    recordedAt: Date.now(),
  }
}

/**
 * Single Broker path for privileged Android actions. A checkpoint is written
 * before dispatch so a process death cannot silently turn a retry into a
 * second click/write/launch.
 */
export async function executeAgentAction<T>(options: AgentExecutionOptions<T>): Promise<T> {
  const principal = AgentPrincipalSchema.parse(options.principal)
  const taskId = options.taskId || 'android-agent'
  const callId = options.callId || options.toolCallId || createAgentId('call')
  const stepId = options.stepId || options.toolCallId || callId
  const attempt = options.attempt || 1
  const deadline = options.deadline || Date.now() + 120_000
  const request = {
    schemaVersion: 1 as const,
    taskId,
    stepId,
    callId,
    attempt,
    toolId: options.toolId,
    toolVersion: 1,
    deadline,
    parameters: options.parameters,
  }
  ToolCallRequestSchema.parse(request)
  const parameterDigest = await digestAgentJson(options.parameters)
  try {
    requireBrokerToolAuthorization({
      featureId: options.featureId,
      toolId: options.toolId,
      backend: options.backend,
      principal,
    })
  } catch (error) {
    appendAgentAudit({
      at: Date.now(),
      callId,
      toolId: options.toolId,
      principal,
      backend: options.backend,
      parameterDigest,
      approvalDecision: 'deny',
      status: 'denied',
      errorCode: brokerErrorCode(error),
    })
    throw error
  }
  const sideEffect = options.sideEffect !== false
  // Parameter-deduplicated calls need a digest lock as well as a call lock.
  // Otherwise two distinct tool-call ids can pass the checkpoint read before
  // either one persists its applied state.
  const lockKey = options.dedupeByParameters
    ? `${taskId}\u0000${options.toolId}\u0000${parameterDigest}`
    : `${taskId}\u0000${stepId}\u0000${callId}`
  const previousLock = actionLocks.get(lockKey)
  if (previousLock) await previousLock

  const run = (async () => {
    const store = options.checkpointStore || getAgentCheckpointStore()
    const previous = await store.get(taskId, stepId, callId)
    const matchingCheckpoint = options.dedupeByParameters
      ? (await store.list(taskId)).find(
          (record) =>
            record.toolId === options.toolId &&
            record.parameterDigest === parameterDigest &&
            ['running', 'applied', 'verified', 'unknown'].includes(record.sideEffectState),
        )
      : undefined
    if (matchingCheckpoint && matchingCheckpoint.callId !== callId) {
      if (matchingCheckpoint.sideEffectState === 'running' || matchingCheckpoint.sideEffectState === 'unknown') {
        throw new AgentActionRecoveryRequiredError(matchingCheckpoint.callId, matchingCheckpoint.sideEffectState)
      }
      throw new AgentActionAlreadyAppliedError(matchingCheckpoint.callId)
    }
    if (previous?.backend && previous.backend !== options.backend) {
      throw new Error('agent_call_backend_mismatch')
    }
    if (previous && previous.parameterDigest !== parameterDigest) {
      throw new Error('agent_call_parameter_mismatch')
    }
    if (sideEffect && (previous?.sideEffectState === 'applied' || previous?.sideEffectState === 'verified')) {
      throw new AgentActionAlreadyAppliedError(callId)
    }
    if (sideEffect && (previous?.sideEffectState === 'running' || previous?.sideEffectState === 'unknown')) {
      throw new AgentActionRecoveryRequiredError(callId, previous.sideEffectState)
    }
    if (options.abortSignal?.aborted) throw new Error('agent_action_cancelled')
    if (Date.now() >= deadline) throw new Error('agent_action_deadline_exceeded')

    const expectedState = options.expectedState ?? {}
    const checkpointRequest = { ...request, backend: options.backend }
    await store.put(checkpointRecordBase(checkpointRequest, parameterDigest, expectedState, 'not_started', null))
    await store.put(checkpointRecordBase(checkpointRequest, parameterDigest, expectedState, 'running', null))

    try {
      const result = await runAbortableBrokerCall(
        options.execute,
        options.abortSignal,
        deadline,
        options.onAbort,
      )
      if (Date.now() >= deadline) throw new Error('agent_action_deadline_exceeded')
      const successful = options.isSuccess ? options.isSuccess(result) : true
      let state: 'not_started' | 'applied' | 'verified' | 'unknown' = successful
        ? sideEffect
          ? 'applied'
          : 'verified'
        : options.failureState || 'not_started'
      if (successful && options.verify) {
        state = (await options.verify(result)) ? 'verified' : 'unknown'
      }
      let resultDigest: string | null = null
      try {
        resultDigest = await digestAgentJson(options.resultToJson ? options.resultToJson(result) : toAgentJson(result))
      } catch {
        // A result digest is audit metadata; failure to calculate it must not
        // erase the safer applied/unknown checkpoint state.
      }
      await store.put(checkpointRecordBase(checkpointRequest, parameterDigest, expectedState, state, resultDigest))
      return result
    } catch (error) {
      await store
        .put(checkpointRecordBase(checkpointRequest, parameterDigest, expectedState, 'unknown', null))
        .catch(() => undefined)
      throw error
    }
  })()
  actionLocks.set(lockKey, run)
  try {
    const result = await run
    const successful = options.isSuccess ? options.isSuccess(result) : true
    appendAgentAudit({
      at: Date.now(),
      callId,
      toolId: options.toolId,
      principal,
      backend: options.backend,
      parameterDigest,
      approvalDecision: options.approvalDecision ?? 'not-required',
      status: successful ? 'success' : 'error',
      ...(successful ? {} : { errorCode: 'backend_reported_failure' }),
    })
    return result
  } catch (error) {
    const errorCode = brokerErrorCode(error)
    appendAgentAudit({
      at: Date.now(),
      callId,
      toolId: options.toolId,
      principal,
      backend: options.backend,
      parameterDigest,
      approvalDecision: options.approvalDecision ?? 'not-required',
      status: errorCode === 'agent_action_cancelled' ? 'cancelled' : 'error',
      errorCode,
    })
    throw error
  } finally {
    if (actionLocks.get(lockKey) === run) actionLocks.delete(lockKey)
  }
}

export async function verifyAgentAction(input: {
  taskId: string
  stepId: string
  callId: string
  verify: (expectedState: JsonValue) => Promise<boolean> | boolean
  checkpointStore?: AgentCheckpointStore
}): Promise<boolean> {
  const store = input.checkpointStore || getAgentCheckpointStore()
  const checkpoint = await store.get(input.taskId, input.stepId, input.callId)
  if (!checkpoint) throw new Error('agent_checkpoint_not_found')
  if (checkpoint.sideEffectState === 'not_started') return false
  if (checkpoint.sideEffectState === 'verified') return true

  const verified = await input.verify(checkpoint.expectedState)
  await store.put({
    ...checkpoint,
    sideEffectState: verified ? 'verified' : 'unknown',
    recordedAt: Date.now(),
  })
  return verified
}

function toolIdForAccessibilityAction(options: AccessibilityActionOptions): ToolId {
  switch (options.action) {
    case 'observe':
    case 'observeSemantic':
      return TOOL_IDS.SCREEN_OBSERVE
    case 'findNode':
      return TOOL_IDS.UI_FIND
    case 'clickNode':
      return TOOL_IDS.UI_TAP
    case 'setNodeText':
    case 'text':
      return TOOL_IDS.UI_TYPE_TEXT
    case 'scrollNode':
    case 'swipe':
      return TOOL_IDS.UI_SWIPE
    case 'launch':
      return TOOL_IDS.APP_LAUNCH
    case 'global':
      if (String(options.key).toUpperCase() === 'HOME') return TOOL_IDS.NAVIGATION_HOME
      if (String(options.key).toUpperCase() === 'RECENTS') return TOOL_IDS.NAVIGATION_RECENTS
      return TOOL_IDS.NAVIGATION_BACK
    default:
      return TOOL_IDS.UI_TAP
  }
}

function isAccessibilitySideEffect(action: AccessibilityActionOptions['action']): boolean {
  return !['observe', 'observeSemantic', 'findNode'].includes(action)
}

export async function executeAccessibilityAction(
  options: AccessibilityActionOptions,
  context: AgentBrokerCallContext = {},
): Promise<AccessibilityActionResult> {
  if (getAgentBackend() !== 'accessibility') {
    return { success: false, reason: 'accessibility_backend_required' }
  }
  try {
    const result = await executeAgentAction({
      featureId: 'android-device',
      principal: context.principal ?? CORE_AGENT_PRINCIPAL,
      toolId: toolIdForAccessibilityAction(options),
      backend: 'accessibility',
      parameters: toAgentJson(options),
      taskId: context.taskId,
      stepId: context.stepId,
      callId: context.callId,
      toolCallId: context.toolCallId,
      attempt: context.attempt,
      deadline: context.deadline,
      abortSignal: context.abortSignal,
      approvalDecision: context.approvalDecision,
      sideEffect: isAccessibilitySideEffect(options.action),
      dedupeByParameters: ['launch', 'clickNode', 'setNodeText', 'text', 'tap', 'global'].includes(options.action),
      failureState: isAccessibilitySideEffect(options.action) ? 'unknown' : 'not_started',
      isSuccess: (result) => result.success,
      execute: () => yachiyoDeviceAccessNative.accessibilityAction(options),
    })
    return result
  } catch (error) {
    if (error instanceof AgentActionAlreadyAppliedError) {
      return { success: false, reason: 'already_applied' }
    }
    if (error instanceof AgentActionRecoveryRequiredError) {
      return { success: false, reason: `recovery_required:${error.state}` }
    }
    throw error
  }
}

/** Launch through the PackageManager bridge for every backend, under the same Broker/checkpoint contract. */
export async function executeAppLaunch(
  packageName: string,
  activityName?: string,
  context: AgentBrokerCallContext = {},
): Promise<AccessibilityActionResult> {
  const parameters = {
    action: 'launch' as const,
    packageName,
    ...(activityName ? { activityName } : {}),
  }
  try {
    const result = await executeAgentAction({
      featureId: 'android-device',
      principal: context.principal ?? CORE_AGENT_PRINCIPAL,
      toolId: TOOL_IDS.APP_LAUNCH,
      backend: getAgentBackend(),
      parameters,
      taskId: context.taskId,
      stepId: context.stepId,
      callId: context.callId,
      toolCallId: context.toolCallId,
      attempt: context.attempt,
      deadline: context.deadline,
      abortSignal: context.abortSignal,
      approvalDecision: context.approvalDecision,
      sideEffect: true,
      dedupeByParameters: true,
      failureState: 'unknown',
      isSuccess: (result) => result.success,
      execute: () => yachiyoDeviceAccessNative.launchApp(packageName, activityName),
    })
    return result
  } catch (error) {
    if (error instanceof AgentActionAlreadyAppliedError) return { success: false, reason: 'already_applied' }
    if (error instanceof AgentActionRecoveryRequiredError) {
      return { success: false, reason: `recovery_required:${error.state}` }
    }
    throw error
  }
}

/** Execute a canonical companion call under the same checkpoint/idempotency contract. */
export async function executeCompanionAction(
  capability: AndroidCanonicalCapability,
  parameters: JsonValue,
  context: AgentBrokerCallContext = {},
): Promise<AndroidControlResult> {
  const registry = companionRegistry
  if (!registry) {
    return {
      companionId: '',
      protocol: 'yachiyo-http',
      capability,
      success: false,
      ok: false,
      error: { code: 'companion_unavailable', message: 'No companion is configured', retryable: false },
      responseBytes: 0,
      truncated: false,
      fallbackToNative: true,
      disabled: false,
    }
  }
  const sideEffect = !['observe', 'find', 'verify'].includes(capability)
  const companionToolId = `android.companion.${capability}` as const
  registerCompanionBrokerTool(companionToolId)
  try {
    return await executeAgentAction({
      featureId: 'android-device',
      principal: context.principal ?? CORE_AGENT_PRINCIPAL,
      toolId: companionToolId,
      backend: 'companion',
      parameters,
      taskId: context.taskId,
      stepId: context.stepId,
      callId: context.callId,
      toolCallId: context.toolCallId,
      attempt: context.attempt,
      deadline: context.deadline,
      abortSignal: context.abortSignal,
      approvalDecision: context.approvalDecision,
      sideEffect,
      dedupeByParameters: sideEffect,
      failureState: sideEffect ? 'unknown' : 'not_started',
      isSuccess: (result) => result.success,
      resultToJson: (result) => ({
        success: result.success,
        capability: result.capability,
        responseBytes: result.responseBytes,
        truncated: result.truncated,
        fallbackToNative: result.fallbackToNative,
      }),
      execute: () => registry.call(capability, parameters as object, { signal: context.abortSignal }),
    })
  } catch (error) {
    if (error instanceof AgentActionAlreadyAppliedError)
      return {
        ...errorResultForCompanion(capability),
        error: { code: 'already_applied', message: 'already_applied', retryable: false },
      }
    if (error instanceof AgentActionRecoveryRequiredError)
      return {
        ...errorResultForCompanion(capability),
        error: { code: `recovery_required:${error.state}`, message: 'recovery_required', retryable: false },
      }
    throw error
  }
}

function errorResultForCompanion(capability: AndroidCanonicalCapability): AndroidControlResult {
  return {
    companionId: '',
    protocol: 'yachiyo-http',
    capability,
    success: false,
    ok: false,
    error: { code: 'companion_action_failed', message: 'companion_action_failed', retryable: false },
    responseBytes: 0,
    truncated: false,
    fallbackToNative: true,
    disabled: false,
  }
}

export async function executeRootShell(
  command: string,
  timeout = 120_000,
  context: AgentBrokerCallContext = {},
): Promise<RootCommandResult> {
  const principal = context.principal ?? CORE_AGENT_PRINCIPAL
  const backend = getAgentBackend()
  if (!isAgentFullAccessEnabled()) {
    const callId = createAgentId('call')
    appendAgentAudit({
      at: Date.now(),
      callId,
      toolId: TOOL_IDS.SHELL_EXEC,
      principal,
      backend,
      parameterDigest: await digestAgentJson({ command, timeout }),
      approvalDecision: context.approvalDecision ?? 'deny',
      status: 'denied',
      errorCode: 'agent_full_access_disabled',
    })
    return { stdout: '', stderr: '完全访问模式未启用', exitCode: 126, timedOut: false }
  }

  if (backend === 'accessibility') {
    return { stdout: '', stderr: '无障碍后端不提供 Shell，请使用设备操作工具', exitCode: 127, timedOut: false }
  }

  const callId = context.callId || context.toolCallId || createAgentId('call')
  try {
    const result = await executeAgentAction({
      featureId: 'android-device',
      principal,
      toolId: TOOL_IDS.SHELL_EXEC,
      backend,
      parameters: { command, timeout },
      callId,
      stepId: context.stepId || callId,
      taskId: context.taskId,
      attempt: context.attempt,
      deadline: context.deadline || Date.now() + timeout,
      abortSignal: context.abortSignal,
      approvalDecision: context.approvalDecision,
      onAbort: backend === 'root' ? async () => void (await yachiyoAgentNative.kill()) : undefined,
      sideEffect: context.sideEffect ?? true,
      failureState: context.sideEffect === false ? 'not_started' : 'unknown',
      isSuccess: (value) => value.exitCode === 0,
      execute: () =>
        backend === 'shizuku'
          ? yachiyoDeviceAccessNative.execShizuku(command, timeout)
          : yachiyoAgentNative.execRoot(command, timeout),
    })
    return result
  } catch (error) {
    if (getAgentBackend() === 'root') persistRootCapability(null)
    throw error
  }
}

export function getCachedRootCapability(): RootCapability | null {
  if (!rootCapabilityCache) rootCapabilityCache = readPersistedRootCapability()
  return rootCapabilityCache
}

export async function getRootCapability(): Promise<RootCapability> {
  const capability = await yachiyoAgentNative.checkRoot()
  persistRootCapability(capability)
  return capability
}

export function clearCachedRootCapability(): void {
  persistRootCapability(null)
}

export function killRootCommand(): Promise<{ killed: boolean }> {
  return yachiyoAgentNative.kill()
}
