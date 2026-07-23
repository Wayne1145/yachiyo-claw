import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSharedUserContextPrompt, getSharedUserContext, saveSharedUserContext } from './shared-user-context'

describe('shared user context', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('migrates User and Memory from the active legacy Agent profile once', () => {
    values.set(
      'yachiyo-agent-profiles-v1',
      JSON.stringify({
        activeProfileId: 'custom',
        profiles: [
          { id: 'builtin', user: 'wrong user', memory: 'wrong memory' },
          { id: 'custom', user: 'Call me Wayne', memory: 'Prefer local tools' },
        ],
      })
    )

    expect(getSharedUserContext()).toEqual({ userProfile: 'Call me Wayne', memory: 'Prefer local tools' })
    expect(JSON.parse(values.get('yachiyo.shared-user-context.v1') || '')).toEqual({
      userProfile: 'Call me Wayne',
      memory: 'Prefer local tools',
    })
  })

  it('does not overwrite an existing shared context with legacy values', () => {
    values.set('yachiyo.shared-user-context.v1', JSON.stringify({ userProfile: 'new user', memory: 'new memory' }))
    values.set(
      'yachiyo-agent-profiles-v1',
      JSON.stringify({ activeProfileId: 'old', profiles: [{ id: 'old', user: 'old user', memory: 'old memory' }] })
    )

    expect(getSharedUserContext()).toEqual({ userProfile: 'new user', memory: 'new memory' })
  })

  it('builds a bounded hidden context block and omits empty sections', () => {
    saveSharedUserContext({ userProfile: '  Chinese replies  ', memory: '' })

    expect(buildSharedUserContextPrompt()).toBe('<user_profile>\nChinese replies\n</user_profile>')
  })
})
