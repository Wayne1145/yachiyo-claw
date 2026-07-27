import { Capacitor } from '@capacitor/core'
import type { AgentPrincipal } from '@shared/agent'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'

export type AgentOperationRisk = 'safe' | 'dangerous'

export interface AgentApprovalRequest {
  id: string
  sessionId: string
  title: string
  detail: string
  risk: AgentOperationRisk
  kind?: 'operation' | 'loop'
  principal: AgentPrincipal
}

export type ApprovalDecision = 'once' | 'conversation' | 'deny'
export interface AgentApprovalAuthorization {
  decision: ApprovalDecision
  approvalNonce?: string
  expiresAt?: number
}
type ApprovalListener = (request: AgentApprovalRequest) => void
export type AgentApprovalLifecycleEvent =
  | {
      state: 'requested'
      sessionId: string
      runId: string
      title: string
      risk: AgentOperationRisk
      kind: 'operation' | 'loop'
      principal: AgentPrincipal
    }
  | { state: 'resolved'; sessionId: string; runId: string; decision: ApprovalDecision; principal: AgentPrincipal }
type ApprovalLifecycleListener = (event: AgentApprovalLifecycleEvent) => void

interface PendingApproval {
  sessionId: string
  runId: string
  resolve: (authorization: AgentApprovalAuthorization) => void
}

interface ApprovalJob {
  sessionId: string
  runId: string
  title: string
  detail: string
  risk: AgentOperationRisk
  kind?: 'operation' | 'loop'
  principal: AgentPrincipal
  bindingDigest?: string
  rememberConversationApproval: boolean
  signal?: AbortSignal
  cancelled: boolean
  settled: boolean
  resolve: (authorization: AgentApprovalAuthorization) => void
  cancelActive?: () => void
}

const listeners = new Set<ApprovalListener>()
const lifecycleListeners = new Set<ApprovalLifecycleListener>()
const pending = new Map<string, PendingApproval>()
const approvalQueue: ApprovalJob[] = []
let activeApproval: ApprovalJob | null = null
let activeAgentSessionId: string | null = null
let activeAgentRunId: string | null = null

export function setActiveAgentSession(sessionId: string | null): void {
  activeAgentSessionId = sessionId
}

export function getActiveAgentSession(): string | null {
  return activeAgentSessionId
}

export function setActiveAgentRun(runId: string | null): void {
  activeAgentRunId = runId
}

export function getActiveAgentRun(): string | null {
  return activeAgentRunId
}

export function onAgentApprovalRequest(listener: ApprovalListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onAgentApprovalLifecycle(listener: ApprovalLifecycleListener): () => void {
  lifecycleListeners.add(listener)
  return () => lifecycleListeners.delete(listener)
}

export function resolveAgentApproval(id: string, decision: ApprovalDecision): void {
  const approval = pending.get(id)
  if (!approval) return
  pending.delete(id)
  approval.resolve({ decision })
}

function matchesApproval(job: ApprovalJob, id?: string): boolean {
  return !id || job.sessionId === id || job.runId === id
}

function settleJob(job: ApprovalJob, authorization: AgentApprovalAuthorization): void {
  if (job.settled) return
  job.settled = true
  job.resolve(authorization)
}

export function cancelPendingAgentApprovals(sessionOrRunId?: string): void {
  for (const job of approvalQueue) {
    if (!matchesApproval(job, sessionOrRunId)) continue
    job.cancelled = true
    settleJob(job, { decision: 'deny' })
  }

  if (activeApproval && matchesApproval(activeApproval, sessionOrRunId)) {
    activeApproval.cancelled = true
    settleJob(activeApproval, { decision: 'deny' })
    activeApproval.cancelActive?.()
  }
}

/** Uninstall/revocation boundary: cancel only approvals originating from this plugin. */
export function cancelPendingPluginApprovals(pluginId: string): void {
  const matchesPlugin = (job: ApprovalJob) => job.principal.kind === 'plugin' && job.principal.pluginId === pluginId

  for (const job of approvalQueue) {
    if (!matchesPlugin(job)) continue
    job.cancelled = true
    settleJob(job, { decision: 'deny' })
  }

  if (activeApproval && matchesPlugin(activeApproval)) {
    activeApproval.cancelled = true
    settleJob(activeApproval, { decision: 'deny' })
    activeApproval.cancelActive?.()
  }
}

function isApprovalAlreadyPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('approval_already_pending')
}

async function requestNativeApproval(job: ApprovalJob): Promise<AgentApprovalAuthorization | null> {
  const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
  if (!permissions.overlay) return null

  const request = () =>
    yachiyoDeviceAccessNative.requestOperationApproval(
      job.title,
      job.detail,
      job.risk === 'dangerous',
      job.bindingDigest
    )
  const remember = (authorization: AgentApprovalAuthorization): AgentApprovalAuthorization => {
    if (
      authorization.decision === 'conversation' &&
      job.rememberConversationApproval &&
      job.principal.kind === 'core'
    ) {
      saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
    }
    return authorization
  }

  try {
    const result = await request()
    return remember(result)
  } catch (error) {
    if (!isApprovalAlreadyPending(error)) throw error

    // A stale native call can survive WebView lifecycle changes. Clear it once
    // and retry on the visible overlay; never fall back to an invisible dialog.
    await yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
    if (job.cancelled || job.signal?.aborted) return { decision: 'deny' }
    try {
      const result = await request()
      return remember(result)
    } catch {
      return { decision: 'deny' }
    }
  }
}

function waitForInAppApproval(job: ApprovalJob): Promise<AgentApprovalAuthorization> {
  if (listeners.size === 0 || job.bindingDigest) return Promise.resolve({ decision: 'deny' })

  const request: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId: job.sessionId,
    title: job.title,
    detail: job.detail,
    risk: job.risk,
    kind: job.kind,
    principal: job.principal,
  }

  return new Promise<AgentApprovalAuthorization>((resolve) => {
    pending.set(request.id, {
      sessionId: job.sessionId,
      runId: job.runId,
      resolve: (authorization) => {
        pending.delete(request.id)
        if (
          authorization.decision === 'conversation' &&
          job.rememberConversationApproval &&
          job.principal.kind === 'core'
        ) {
          saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
        }
        resolve(authorization)
      },
    })
    listeners.forEach((listener) => listener(request))
  })
}

async function executeApprovalJob(job: ApprovalJob): Promise<AgentApprovalAuthorization> {
  if (job.cancelled || job.signal?.aborted) return { decision: 'deny' }

  let cancelResolve: (authorization: AgentApprovalAuthorization) => void = () => undefined
  const cancelled = new Promise<AgentApprovalAuthorization>((resolve) => {
    cancelResolve = resolve
  })
  const abort = () => {
    job.cancelled = true
    for (const [id, approval] of pending) {
      if (approval.runId === job.runId) {
        pending.delete(id)
        approval.resolve({ decision: 'deny' })
      }
    }
    void yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
    cancelResolve({ decision: 'deny' })
  }
  job.cancelActive = abort
  job.signal?.addEventListener('abort', abort, { once: true })

  try {
    if (Capacitor.isNativePlatform()) {
      try {
        const nativeDecision = await Promise.race([requestNativeApproval(job), cancelled])
        if (nativeDecision !== null) return nativeDecision
      } catch {
        // Only unavailable native overlays use the foreground in-app dialog.
      }
    }
    if (job.bindingDigest) return { decision: 'deny' }
    return await Promise.race([waitForInAppApproval(job), cancelled])
  } finally {
    job.signal?.removeEventListener('abort', abort)
    job.cancelActive = undefined
  }
}

function pumpApprovalQueue(): void {
  if (activeApproval) return
  const job = approvalQueue.shift()
  if (!job) return
  if (job.cancelled || job.signal?.aborted) {
    settleJob(job, { decision: 'deny' })
    pumpApprovalQueue()
    return
  }

  activeApproval = job
  lifecycleListeners.forEach((listener) =>
    listener({
      state: 'requested',
      sessionId: job.sessionId,
      runId: job.runId,
      title: job.title,
      risk: job.risk,
      kind: job.kind || 'operation',
      principal: job.principal,
    })
  )
  void executeApprovalJob(job)
    .then((authorization) => {
      lifecycleListeners.forEach((listener) =>
        listener({
          state: 'resolved',
          sessionId: job.sessionId,
          runId: job.runId,
          decision: authorization.decision,
          principal: job.principal,
        })
      )
      settleJob(job, authorization)
    })
    .catch(() => settleJob(job, { decision: 'deny' }))
    .finally(() => {
      if (activeApproval === job) activeApproval = null
      pumpApprovalQueue()
    })
}

export async function requestAgentAuthorization(
  input: Omit<AgentApprovalRequest, 'id' | 'sessionId'> & {
    sessionId?: string | null
    /** Identifies one generated Agent run so cancellation cannot hit another run. */
    runId?: string | null
    mutating?: boolean
    signal?: AbortSignal
    /** Loop warnings must be shown even when operation approval is disabled. */
    alwaysAsk?: boolean
    /** Only operation approvals may grant a conversation-wide dangerous-action allowance. */
    rememberConversationApproval?: boolean
    /** Optional SHA-256 binding consumed once by the native privileged operation. */
    bindingDigest?: string
  }
): Promise<AgentApprovalAuthorization> {
  const sessionId = input.sessionId || activeAgentSessionId
  if (!sessionId || input.mutating === false) {
    return { decision: input.bindingDigest ? 'deny' : 'once' }
  }

  const config = getAgentSessionConfig(sessionId)
  const canUseConversationGrant = input.principal.kind === 'core' && config.allowDangerousForConversation
  if (!input.alwaysAsk && !input.bindingDigest && (config.approvalMode === 'full' || canUseConversationGrant)) {
    return { decision: 'once' }
  }
  if (!input.alwaysAsk && !input.bindingDigest && config.approvalMode === 'smart' && input.risk === 'safe') {
    return { decision: 'once' }
  }
  if (input.signal?.aborted) return { decision: 'deny' }

  return await new Promise<AgentApprovalAuthorization>((resolve) => {
    approvalQueue.push({
      sessionId,
      runId: input.runId || sessionId,
      title: input.title,
      detail: input.detail,
      risk: input.risk,
      kind: input.kind,
      principal: input.principal,
      bindingDigest: input.bindingDigest,
      rememberConversationApproval: input.principal.kind === 'core' && (input.rememberConversationApproval ?? true),
      signal: input.signal,
      cancelled: false,
      settled: false,
      resolve,
    })
    pumpApprovalQueue()
  })
}

export async function requestAgentDecision(
  input: Parameters<typeof requestAgentAuthorization>[0]
): Promise<ApprovalDecision> {
  return (await requestAgentAuthorization(input)).decision
}

export async function requestAgentApproval(input: Parameters<typeof requestAgentDecision>[0]): Promise<boolean> {
  return (await requestAgentDecision(input)) !== 'deny'
}

const DANGEROUS_SHELL_PATTERN =
  /(^|[\s;&|`$()])(?:busybox\s+|toybox\s+)?(rm|rmdir|unlink|truncate|reboot|shutdown|wipe|mkfs|dd\s+if=|mv|cp\s+.*(?:\/data|\/system)|sed\s+-i|pm\s+(install|uninstall|disable|clear)|settings\s+(put|delete)|content\s+(insert|update|delete)|setprop|chmod|chown|mount|iptables|am\s+force-stop|sh\s+-c|bash\s+-c|curl|wget)\b/i

export function assessShellRisk(command: string): AgentOperationRisk {
  return DANGEROUS_SHELL_PATTERN.test(command) ? 'dangerous' : 'safe'
}
