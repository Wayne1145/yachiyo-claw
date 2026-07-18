import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_RUNTIME_SETTINGS,
  getAgentRuntimeSettings,
  saveAgentRuntimeSettings,
} from './agent-runtime-settings'

describe('agent runtime settings', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  it('defaults to returning to the app and persists an override', () => {
    expect(getAgentRuntimeSettings()).toEqual(DEFAULT_AGENT_RUNTIME_SETTINGS)
    saveAgentRuntimeSettings({ returnToAppOnComplete: false })
    expect(getAgentRuntimeSettings().returnToAppOnComplete).toBe(false)
  })
})
