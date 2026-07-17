import { YACHIYO_PERSONA_ID, YACHIYO_PERSONA_NAME, YACHIYO_SOUL } from '@shared/personas/yachiyo'
import { createMessage, type Session } from '@shared/types'
import { getSession, updateSessionWithMessages } from '@/stores/chatStore'
import { BUILT_IN_LIVE2D_MODEL_ID } from './live2d-models'

export interface CharacterProfile {
  id: string
  name: string
  avatar: string
  prompt: string
  live2dModelId: string
  defaultLlmProvider?: string
  defaultLlmModel?: string
  defaultTtsProvider: 'bing' | 'android-system' | 'openai-compatible'
  defaultTtsModel: string
}

const PROFILES_KEY = 'yachiyo.characters.v1'
const SESSION_MAP_KEY = 'yachiyo.character.sessions.v1'
export const DEFAULT_CHARACTER: CharacterProfile = {
  id: YACHIYO_PERSONA_ID,
  name: YACHIYO_PERSONA_NAME,
  avatar: '/live2d/yachiyo/avatar.png',
  prompt: YACHIYO_SOUL,
  live2dModelId: BUILT_IN_LIVE2D_MODEL_ID,
  defaultTtsProvider: 'bing',
  defaultTtsModel: 'edge-read-aloud',
}

export function listCharacterProfiles(): CharacterProfile[] {
  try {
    const values = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]') as CharacterProfile[]
    return [DEFAULT_CHARACTER, ...values.filter((profile) => profile.id !== DEFAULT_CHARACTER.id)]
  } catch { return [DEFAULT_CHARACTER] }
}

export function saveCharacterProfile(profile: CharacterProfile) {
  const profiles = listCharacterProfiles().filter((item) => item.id !== DEFAULT_CHARACTER.id && item.id !== profile.id)
  if (profile.id !== DEFAULT_CHARACTER.id) profiles.push(profile)
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
  window.dispatchEvent(new Event('yachiyo-characters-changed'))
}

function readSessionMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SESSION_MAP_KEY) || '{}') }
  catch { return {} }
}

export function getSessionCharacter(sessionId?: string): CharacterProfile {
  const id = sessionId ? readSessionMap()[sessionId] : undefined
  return listCharacterProfiles().find((profile) => profile.id === id) || DEFAULT_CHARACTER
}

export async function selectSessionCharacter(sessionId: string, profile: CharacterProfile) {
  localStorage.setItem(SESSION_MAP_KEY, JSON.stringify({ ...readSessionMap(), [sessionId]: profile.id }))
  const session = await getSession(sessionId)
  if (!session) return
  await updateSessionWithMessages(sessionId, (latest) => {
    if (!latest) throw new Error('chat_session_not_found')
    const messages = latest.messages.filter((message) => message.role !== 'system')
    return { ...latest, messages: [createMessage('system', profile.prompt), ...messages] } as Session
  })
  window.dispatchEvent(new Event('yachiyo-session-character-changed'))
}
