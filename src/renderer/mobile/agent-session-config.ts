import type { AgentBackend } from './agent-broker'
import { getAgentBackend, setAgentBackend } from './agent-broker'

const CONFIG_KEY = 'yachiyo-agent-session-config-v2'
const LEGACY_CONFIG_KEY = 'yachiyo-agent-session-config-v1'

export type AgentApprovalMode = 'manual' | 'smart' | 'full'

export interface AgentSessionConfig {
  /** Enables internal tools such as sandbox, Skills, MCP, files, and retrieval. */
  enabled: boolean
  /** Adds privileged Android phone-control tools to the internal Agent. */
  deviceControlEnabled: boolean
  configured: boolean
  backend: AgentBackend
  approvalMode: AgentApprovalMode
  allowDangerousForConversation: boolean
}

const defaultConfig = (): AgentSessionConfig => ({
  enabled: false,
  deviceControlEnabled: false,
  configured: false,
  backend: getAgentBackend(),
  approvalMode: 'manual',
  allowDangerousForConversation: false,
})

function readAll(): Record<string, AgentSessionConfig> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const current = localStorage.getItem(CONFIG_KEY)
    if (current) return JSON.parse(current) as Record<string, AgentSessionConfig>

    const legacy = JSON.parse(localStorage.getItem(LEGACY_CONFIG_KEY) || '{}') as Record<
      string,
      Partial<AgentSessionConfig>
    >
    const migrated = Object.fromEntries(
      Object.entries(legacy).map(([sessionId, config]) => [
        sessionId,
        {
          ...defaultConfig(),
          ...config,
          // Before v2, enabling Agent always enabled phone control as well.
          deviceControlEnabled: Boolean(config.enabled),
        },
      ]),
    )
    if (Object.keys(migrated).length > 0) {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated))
    }
    return migrated
  } catch {
    return {}
  }
}

export function getAgentSessionConfig(sessionId?: string | null): AgentSessionConfig {
  if (!sessionId) return defaultConfig()
  return { ...defaultConfig(), ...readAll()[sessionId] }
}

export function saveAgentSessionConfig(sessionId: string, patch: Partial<AgentSessionConfig>): AgentSessionConfig {
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
