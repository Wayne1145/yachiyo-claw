import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAgentIdentityPrompt, getAgentProfileState, saveAgentProfileState } from './agent-profile'

describe('Android Agent profiles', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('ships the Yachiyo soul as the only built-in profile', () => {
    const state = getAgentProfileState()
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].soul).toContain('你不是机器人。你是月见八千代。')
  })

  it('combines Agent Soul with migrated shared User and Memory context', () => {
    const state = getAgentProfileState()
    state.profiles[0] = { ...state.profiles[0], user: '称呼用户为 Wayne', memory: '偏好本地优先' }
    saveAgentProfileState(state)
    const prompt = buildAgentIdentityPrompt()
    expect(prompt).toContain('<agent_soul>')
    expect(prompt).toContain('<user_profile>')
    expect(prompt).toContain('<memory>')
  })
})
