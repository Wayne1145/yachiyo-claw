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
  resolve: (decision: ApprovalDecision) => void
}

const listeners = new Set<ApprovalListener>()
const pending = new Map<string, PendingApproval>()
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
  pending.get(id)?.resolve(decision)
  pending.delete(id)
}

export function cancelPendingAgentApprovals(sessionId?: string): void {
  for (const [id, approval] of pending.entries()) {
    if (!sessionId || approval.sessionId === sessionId) {
      approval.resolve('deny')
      pending.delete(id)
    }
  }
  if (Capacitor.isNativePlatform()) {
    void yachiyoDeviceAccessNative.cancelOperationApproval().catch(() => undefined)
  }
}

export async function requestAgentApproval(input: Omit<AgentApprovalRequest, 'id' | 'sessionId'> & {
  sessionId?: string | null
  mutating?: boolean
}): Promise<boolean> {
  const sessionId = input.sessionId || activeAgentSessionId
  if (!sessionId || input.mutating === false) return true

  const config = getAgentSessionConfig(sessionId)
  if (config.approvalMode === 'full' || config.allowDangerousForConversation) return true
  if (config.approvalMode === 'smart' && input.risk === 'safe') return true

  if (Capacitor.isNativePlatform()) {
    try {
      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      if (permissions.overlay) {
        const result = await yachiyoDeviceAccessNative.requestOperationApproval(
          input.title,
          input.detail,
          input.risk === 'dangerous'
        )
        if (result.decision === 'conversation') {
          saveAgentSessionConfig(sessionId, { allowDangerousForConversation: true })
        }
        return result.decision !== 'deny'
      }
    } catch {
      // The in-app dialog remains the fallback when the native overlay is unavailable.
    }
  }

  if (listeners.size === 0) return false

  const request: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId,
    title: input.title,
    detail: input.detail,
    risk: input.risk,
  }

  return await new Promise<boolean>((resolve) => {
    pending.set(request.id, {
      sessionId,
      resolve: (decision) => {
        if (decision === 'conversation') {
          saveAgentSessionConfig(sessionId, { allowDangerousForConversation: true })
        }
        resolve(decision !== 'deny')
      },
    })
    listeners.forEach((listener) => listener(request))
  })
}

const DANGEROUS_SHELL_PATTERN =
  /(^|[\s;&|`$()])(?:busybox\s+|toybox\s+)?(rm|rmdir|unlink|truncate|reboot|shutdown|wipe|mkfs|dd\s+if=|mv|cp\s+.*(?:\/data|\/system)|sed\s+-i|pm\s+(install|uninstall|disable|clear)|settings\s+(put|delete)|content\s+(insert|update|delete)|setprop|chmod|chown|mount|iptables|am\s+force-stop|sh\s+-c|bash\s+-c|curl|wget)\b/i

export function assessShellRisk(command: string): AgentOperationRisk {
  return DANGEROUS_SHELL_PATTERN.test(command) ? 'dangerous' : 'safe'
}
