export interface AgentRuntimeSettings {
  returnToAppOnComplete: boolean
}

const STORAGE_KEY = 'yachiyo-agent-runtime-settings-v1'

export const DEFAULT_AGENT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  returnToAppOnComplete: true,
}

export function getAgentRuntimeSettings(): AgentRuntimeSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_AGENT_RUNTIME_SETTINGS
  try {
    return {
      ...DEFAULT_AGENT_RUNTIME_SETTINGS,
      ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AgentRuntimeSettings>),
    }
  } catch {
    return DEFAULT_AGENT_RUNTIME_SETTINGS
  }
}

export function saveAgentRuntimeSettings(patch: Partial<AgentRuntimeSettings>): AgentRuntimeSettings {
  const next = { ...getAgentRuntimeSettings(), ...patch }
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
