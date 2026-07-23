import { YACHIYO_PERSONA_ID, YACHIYO_PERSONA_NAME, YACHIYO_SOUL } from '@shared/personas/yachiyo'
import { buildSharedUserContextPrompt } from './shared-user-context'

const AGENT_PROFILE_KEY = 'yachiyo-agent-profiles-v1'

export interface AgentProfile {
  id: string
  name: string
  soul: string
  /** @deprecated Migrated to shared-user-context and retained for stored-profile compatibility. */
  user?: string
  /** @deprecated Migrated to shared-user-context and retained for stored-profile compatibility. */
  memory?: string
  builtin?: boolean
}

export interface AgentProfileState {
  activeProfileId: string
  profiles: AgentProfile[]
}

const builtinProfile = (): AgentProfile => ({
  id: YACHIYO_PERSONA_ID,
  name: YACHIYO_PERSONA_NAME,
  soul: YACHIYO_SOUL,
  builtin: true,
})

function initialState(): AgentProfileState {
  return { activeProfileId: YACHIYO_PERSONA_ID, profiles: [builtinProfile()] }
}

export function getAgentProfileState(): AgentProfileState {
  if (typeof localStorage === 'undefined') return initialState()
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_PROFILE_KEY) || '') as AgentProfileState
    if (!parsed.profiles?.length) return initialState()
    const profiles = parsed.profiles.some((profile) => profile.id === YACHIYO_PERSONA_ID)
      ? parsed.profiles
      : [builtinProfile(), ...parsed.profiles]
    const activeProfileId = profiles.some((profile) => profile.id === parsed.activeProfileId)
      ? parsed.activeProfileId
      : YACHIYO_PERSONA_ID
    return { activeProfileId, profiles }
  } catch {
    return initialState()
  }
}

export function saveAgentProfileState(state: AgentProfileState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(AGENT_PROFILE_KEY, JSON.stringify(state))
}

export function getActiveAgentProfile(): AgentProfile {
  const state = getAgentProfileState()
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0]
}

export function buildAgentIdentityPrompt(profile = getActiveAgentProfile()): string {
  return [
    '<agent_soul>',
    profile.soul.trim(),
    '</agent_soul>',
    buildSharedUserContextPrompt(),
  ]
    .filter(Boolean)
    .join('\n\n')
}
