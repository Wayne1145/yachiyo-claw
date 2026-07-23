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
  kind?: 'operation' | 'loop'
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
  kind?: 'operation' | 'loop'
  rememberConversationApproval: boolean
  signal?: AbortSignal
  cancelled: boolean
  settled: boolean
  resolve: (decision: ApprovalDecision) => void
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

function settleJob(job: ApprovalJob, decision: ApprovalDecision): void {
  if (job.settled) return
  job.settled = true
  job.resolve(decision)
}

export function cancelPendingAgentApprovals(sessionOrRunId?: string): void {
  for (const job of approvalQueue) {
    if (!matchesApproval(job, sessionOrRunId)) continue
    job.cancelled = true
    settleJob(job, 'deny')
  }

  if (activeApproval && matchesApproval(activeApproval, sessionOrRunId)) {
    activeApproval.cancelled = true
    settleJob(activeApproval, 'deny')
    activeApproval.cancelActive?.()
  }
}

function isApprovalAlreadyPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('approval_already_pending')
}

async function requestNativeApproval(job: ApprovalJob): Promise<ApprovalDecision | null> {
  const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
  if (!permissions.overlay) return null

  const request = () =>
    yachiyoDeviceAccessNative.requestOperationApproval(job.title, job.detail, job.risk === 'dangerous')
  const remember = (decision: ApprovalDecision): ApprovalDecision => {
    if (decision === 'conversation' && job.rememberConversationApproval) {
      saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
    }
    return decision
  }

  try {
    const result = await request()
    return remember(result.decision)
  } catch (error) {
    if (!isApprovalAlreadyPending(error)) throw error

    // A stale native call can survive WebView lifecycle changes. Clear it once
    // and retry on the visible overlay; never fall back to an invisible dialog.
    await yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
    if (job.cancelled || job.signal?.aborted) return 'deny'
    try {
      const result = await request()
      return remember(result.decision)
    } catch {
      return 'deny'
    }
  }
}

function waitForInAppApproval(job: ApprovalJob): Promise<ApprovalDecision> {
  if (listeners.size === 0) return Promise.resolve('deny')

  const request: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId: job.sessionId,
    title: job.title,
    detail: job.detail,
    risk: job.risk,
    kind: job.kind,
  }

  return new Promise<ApprovalDecision>((resolve) => {
    pending.set(request.id, {
      sessionId: job.sessionId,
      runId: job.runId,
      resolve: (decision) => {
        pending.delete(request.id)
        if (decision === 'conversation' && job.rememberConversationApproval) {
          saveAgentSessionConfig(job.sessionId, { allowDangerousForConversation: true })
        }
        resolve(decision)
      },
    })
    listeners.forEach((listener) => listener(request))
  })
}

async function executeApprovalJob(job: ApprovalJob): Promise<ApprovalDecision> {
  if (job.cancelled || job.signal?.aborted) return 'deny'

  let cancelResolve: (decision: ApprovalDecision) => void = () => undefined
  const cancelled = new Promise<ApprovalDecision>((resolve) => {
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
    cancelResolve('deny')
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
    settleJob(job, 'deny')
    pumpApprovalQueue()
    return
  }

  activeApproval = job
  void executeApprovalJob(job)
    .then((decision) => settleJob(job, decision))
    .catch(() => settleJob(job, 'deny'))
    .finally(() => {
      if (activeApproval === job) activeApproval = null
      pumpApprovalQueue()
    })
}

export async function requestAgentDecision(
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
  },
): Promise<ApprovalDecision> {
  const sessionId = input.sessionId || activeAgentSessionId
  if (!sessionId || input.mutating === false) return 'once'

  const config = getAgentSessionConfig(sessionId)
  if (!input.alwaysAsk && (config.approvalMode === 'full' || config.allowDangerousForConversation)) return 'once'
  if (!input.alwaysAsk && config.approvalMode === 'smart' && input.risk === 'safe') return 'once'
  if (input.signal?.aborted) return 'deny'

  return await new Promise<ApprovalDecision>((resolve) => {
    approvalQueue.push({
      sessionId,
      runId: input.runId || sessionId,
      title: input.title,
      detail: input.detail,
      risk: input.risk,
      kind: input.kind,
      rememberConversationApproval: input.rememberConversationApproval ?? true,
      signal: input.signal,
      cancelled: false,
      settled: false,
      resolve,
    })
    pumpApprovalQueue()
  })
}

export async function requestAgentApproval(
  input: Parameters<typeof requestAgentDecision>[0],
): Promise<boolean> {
  return (await requestAgentDecision(input)) !== 'deny'
}

const DANGEROUS_SHELL_PATTERN =
  /(^|[\s;&|`$()])(?:busybox\s+|toybox\s+)?(rm|rmdir|unlink|truncate|reboot|shutdown|wipe|mkfs|dd\s+if=|mv|cp\s+.*(?:\/data|\/system)|sed\s+-i|pm\s+(install|uninstall|disable|clear)|settings\s+(put|delete)|content\s+(insert|update|delete)|setprop|chmod|chown|mount|iptables|am\s+force-stop|sh\s+-c|bash\s+-c|curl|wget)\b/i

export function assessShellRisk(command: string): AgentOperationRisk {
  return DANGEROUS_SHELL_PATTERN.test(command) ? 'dangerous' : 'safe'
}
