import { getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'

export type AgentOperationRisk = 'safe' | 'dangerous'

export interface AgentApprovalRequest {
  id: string
  sessionId: string
  title: string
  detail: string
  risk: AgentOperationRisk
}

type ApprovalDecision = 'once' | 'conversation' | 'deny'
type ApprovalListener = (request: AgentApprovalRequest) => void

const listeners = new Set<ApprovalListener>()
const pending = new Map<string, (decision: ApprovalDecision) => void>()
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
  pending.get(id)?.(decision)
  pending.delete(id)
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
  if (listeners.size === 0) return false

  const request: AgentApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId,
    title: input.title,
    detail: input.detail,
    risk: input.risk,
  }

  return await new Promise<boolean>((resolve) => {
    pending.set(request.id, (decision) => {
      if (decision === 'conversation') {
        saveAgentSessionConfig(sessionId, { allowDangerousForConversation: true })
      }
      resolve(decision !== 'deny')
    })
    listeners.forEach((listener) => listener(request))
  })
}

const DANGEROUS_SHELL_PATTERN =
  /(^|[;&|]\s*)(rm|rmdir|truncate|reboot|shutdown|wipe|mkfs|dd\s+if=|pm\s+(install|uninstall|disable|clear)|settings\s+(put|delete)|content\s+(insert|update|delete)|setprop|chmod\s+777|chown|mount\s+-o\s+rw|iptables|am\s+force-stop)\b/i

export function assessShellRisk(command: string): AgentOperationRisk {
  return DANGEROUS_SHELL_PATTERN.test(command) ? 'dangerous' : 'safe'
}
