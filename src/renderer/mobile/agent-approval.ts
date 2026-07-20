import { Capacitor } from '@capacitor/core'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'

export type AgentOperationRisk = 'safe' | 'dangerous'

export interface AgentApprovalRequest {
  id: string
  sessionId: string
  title: string
  detail: string
  risk: AgentOperationRisk
}

export type ApprovalDecision = 'once' | 'conversation' | 'deny'
type ApprovalListener = (request: AgentApprovalRequest) => void

interface PendingApproval {
  sessionId: string
  runId: string
  resolve: (decision: ApprovalDecision) => void
}

interface ApprovalJob {
  sessionId: string
  runId: string
  title: string
  detail: string
  risk: AgentOperationRisk
  signal?: AbortSignal
  cancelled: boolean
  settled: boolean
  resolve: (approved: boolean) => void
  cancelActive?: () => void
}

const listeners = new Set<ApprovalListener>()
const pending = new Map<string, PendingApproval>()
const approvalQueue: ApprovalJob[] = []
let activeApproval: ApprovalJob | null = null
let activeAgentSessionId: string | null = null

export function setActiveAgentSession(sessionId: string | null): void {
  activeAgentSessionId = sessionId
}

export function getActiveAgentSession(): string | null {
  return activeAgentSessionId
}

export function onAgentApprovalRequest(listener: ApprovalListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resolveAgentApproval(id: string, decision: ApprovalDecision): void {
  const approval = pending.get(id)
  if (!approval) return
  pending.delete(id)
  approval.resolve(decision)
}

function matchesApproval(job: ApprovalJob, id?: string): boolean {
  return !id || job.sessionId === id || job.runId === id
}

function settleJob(job: ApprovalJob, approved: boolean): void {
  if (job.settled) return
  job.settled = true
  job.resolve(approved)
}

export function cancelPendingAgentApprovals(sessionOrRunId?: string): void {
  for (const job of approvalQueue) {
    if (!matchesApproval(job, sessionOrRunId)) continue
    job.cancelled = true
    settleJob(job, false)
  }

  if (activeApproval && matchesApproval(activeApproval, sessionOrRunId)) {
    activeApproval.cancelled = true
    settleJob(activeApproval, false)
    activeApproval.cancelActive?.()
  }
}

function isApprovalAlreadyPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('approval_already_pending')
}

async function requestNativeApproval(job: ApprovalJob): Promise<boolean | null> {
  const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
  if (!permissions.overlay) return null

  const request = () =>
    yachiyoDeviceAccessNative.requestOperationApproval(job.title, job.detail, job.risk === 'dangerous')
  const approved = (decision: ApprovalDecision): boolean => {
    if (decision === 'conversation') {
      saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
    }
    return decision !== 'deny'
  }

  try {
    const result = await request()
    return approved(result.decision)
  } catch (error) {
    if (!isApprovalAlreadyPending(error)) throw error

    // A stale native call can survive WebView lifecycle changes. Clear it once
    // and retry on the visible overlay; never fall back to an invisible dialog.
    await yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
    if (job.cancelled || job.signal?.aborted) return false
    try {
      const result = await request()
      return approved(result.decision)
    } catch {
      return false
    }
  }
}

function waitForInAppApproval(job: ApprovalJob): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(false)

  const request: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId: job.sessionId,
    title: job.title,
    detail: job.detail,
    risk: job.risk,
  }

  return new Promise<boolean>((resolve) => {
    pending.set(request.id, {
      sessionId: job.sessionId,
      runId: job.runId,
      resolve: (decision) => {
        pending.delete(request.id)
        if (decision === 'conversation') {
          saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
        }
        resolve(decision !== 'deny')
      },
    })
    listeners.forEach((listener) => listener(request))
  })
}

async function executeApprovalJob(job: ApprovalJob): Promise<boolean> {
  if (job.cancelled || job.signal?.aborted) return false

  let cancelResolve: (approved: boolean) => void = () => undefined
  const cancelled = new Promise<boolean>((resolve) => {
    cancelResolve = resolve
  })
  const abort = () => {
    job.cancelled = true
    for (const [id, approval] of pending) {
      if (approval.runId === job.runId) {
        pending.delete(id)
        approval.resolve('deny')
      }
    }
    void yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
    cancelResolve(false)
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
    settleJob(job, false)
    pumpApprovalQueue()
    return
  }

  activeApproval = job
  void executeApprovalJob(job)
    .then((approved) => settleJob(job, approved))
    .catch(() => settleJob(job, false))
    .finally(() => {
      if (activeApproval === job) activeApproval = null
      pumpApprovalQueue()
    })
}

export async function requestAgentApproval(
  input: Omit<AgentApprovalRequest, 'id' | 'sessionId'> & {
    sessionId?: string | null
    /** Identifies one generated Agent run so cancellation cannot hit another run. */
    runId?: string | null
    mutating?: boolean
    signal?: AbortSignal
  },
): Promise<boolean> {
  const sessionId = input.sessionId || activeAgentSessionId
  if (!sessionId || input.mutating === false) return true

  const config = getAgentSessionConfig(sessionId)
  if (config.approvalMode === 'full' || config.allowDangerousForConversation) return true
  if (config.approvalMode === 'smart' && input.risk === 'safe') return true
  if (input.signal?.aborted) return false

  return await new Promise<boolean>((resolve) => {
    approvalQueue.push({
      sessionId,
      runId: input.runId || sessionId,
      title: input.title,
      detail: input.detail,
      risk: input.risk,
      signal: input.signal,
      cancelled: false,
      settled: false,
      resolve,
    })
    pumpApprovalQueue()
  })
}

const DANGEROUS_SHELL_PATTERN =
  /(^|[\s;&|`$()])(?:busybox\s+|toybox\s+)?(rm|rmdir|unlink|truncate|reboot|shutdown|wipe|mkfs|dd\s+if=|mv|cp\s+.*(?:\/data|\/system)|sed\s+-i|pm\s+(install|uninstall|disable|clear)|settings\s+(put|delete)|content\s+(insert|update|delete)|setprop|chmod|chown|mount|iptables|am\s+force-stop|sh\s+-c|bash\s+-c|curl|wget)\b/i

export function assessShellRisk(command: string): AgentOperationRisk {
  return DANGEROUS_SHELL_PATTERN.test(command) ? 'dangerous' : 'safe'
}
