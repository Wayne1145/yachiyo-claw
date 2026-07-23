const SHARED_USER_CONTEXT_KEY = 'yachiyo.shared-user-context.v1'
const LEGACY_AGENT_PROFILES_KEY = 'yachiyo-agent-profiles-v1'

export interface SharedUserContext {
  userProfile: string
  memory: string
}

const EMPTY_CONTEXT: SharedUserContext = {
  userProfile: '',
  memory: '',
}

function normalizeContext(value: Partial<SharedUserContext> | undefined): SharedUserContext {
  return {
    userProfile: typeof value?.userProfile === 'string' ? value.userProfile : '',
    memory: typeof value?.memory === 'string' ? value.memory : '',
  }
}

function readLegacyAgentContext(): SharedUserContext | null {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_AGENT_PROFILES_KEY) || '') as {
      activeProfileId?: string
      profiles?: Array<{ id?: string; user?: string; memory?: string }>
    }
    if (!legacy.profiles?.length) return null
    const profile = legacy.profiles.find((item) => item.id === legacy.activeProfileId) || legacy.profiles[0]
    const context = normalizeContext({ userProfile: profile.user, memory: profile.memory })
    return context.userProfile || context.memory ? context : null
  } catch {
    return null
  }
}

export function getSharedUserContext(): SharedUserContext {
  if (typeof localStorage === 'undefined') return { ...EMPTY_CONTEXT }
  try {
    const stored = localStorage.getItem(SHARED_USER_CONTEXT_KEY)
    if (stored !== null) return normalizeContext(JSON.parse(stored) as Partial<SharedUserContext>)
  } catch {
    // Fall through to legacy migration when the new value is unreadable.
  }

  const migrated = readLegacyAgentContext() || { ...EMPTY_CONTEXT }
  localStorage.setItem(SHARED_USER_CONTEXT_KEY, JSON.stringify(migrated))
  return migrated
}

export function saveSharedUserContext(context: SharedUserContext): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SHARED_USER_CONTEXT_KEY, JSON.stringify(normalizeContext(context)))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('yachiyo-shared-user-context-changed'))
  }
}

export function buildSharedUserContextPrompt(context = getSharedUserContext()): string {
  return [
    context.userProfile.trim() ? `<user_profile>\n${context.userProfile.trim()}\n</user_profile>` : '',
    context.memory.trim() ? `<memory>\n${context.memory.trim()}\n</memory>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
