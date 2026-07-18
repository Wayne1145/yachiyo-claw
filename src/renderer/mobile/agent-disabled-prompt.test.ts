import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAgentSessionConfig } from './agent-session-config'
import { getDisabledAgentCapabilityPrompt } from './agent-disabled-prompt'

describe('disabled Agent capability prompt', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    vi.stubGlobal('CustomEvent', class {
      constructor(public type: string, public init?: unknown) {}
    })
  })

  it('guides the model only while Agent capability is disabled', () => {
    expect(getDisabledAgentCapabilityPrompt('chat-1')).toContain('Agent 能力')
    saveAgentSessionConfig('chat-1', { enabled: true })
    expect(getDisabledAgentCapabilityPrompt('chat-1')).toBe('')
  })
})
