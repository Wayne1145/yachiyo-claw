import type { AgentBackend } from './agent-broker'
import { getAgentBackend, setAgentBackend } from './agent-broker'

const CONFIG_KEY = 'yachiyo-agent-session-config-v1'

export type AgentApprovalMode = 'manual' | 'smart' | 'full'

export interface AgentSessionConfig {
  enabled: boolean
  configured: boolean
  backend: AgentBackend
  approvalMode: AgentApprovalMode
  allowDangerousForConversation: boolean
}

const defaultConfig = (): AgentSessionConfig => ({
  enabled: false,
  configured: false,
  backend: getAgentBackend(),
  approvalMode: 'manual',
  allowDangerousForConversation: false,
})

function readAll(): Record<string, AgentSessionConfig> {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') as Record<string, AgentSessionConfig>
  } catch {
    return {}
  }
}

export function getAgentSessionConfig(sessionId?: string | null): AgentSessionConfig {
  if (!sessionId) return defaultConfig()
  return { ...defaultConfig(), ...readAll()[sessionId] }
}

export function saveAgentSessionConfig(
  sessionId: string,
  patch: Partial<AgentSessionConfig>
): AgentSessionConfig {
  const all = readAll()
  const next = { ...defaultConfig(), ...all[sessionId], ...patch }
  all[sessionId] = next
  localStorage.setItem(CONFIG_KEY, JSON.stringify(all))
  setAgentBackend(next.backend)
  window.dispatchEvent(new CustomEvent('yachiyo-agent-session-config', { detail: { sessionId, config: next } }))
  return next
}

export function copyAgentSessionConfig(sourceId: string, targetId: string): AgentSessionConfig {
  const source = getAgentSessionConfig(sourceId)
  return saveAgentSessionConfig(targetId, { ...source, allowDangerousForConversation: false })
}

export function deleteAgentSessionConfig(sessionId: string): void {
  if (typeof localStorage === 'undefined') return
  const all = readAll()
  delete all[sessionId]
  localStorage.setItem(CONFIG_KEY, JSON.stringify(all))
}
