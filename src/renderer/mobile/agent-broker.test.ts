import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANDROID_AGENT_WORKING_DIRECTORY,
  clearCachedRootCapability,
  executeRootShell,
  getAgentWorkingDirectory,
  getCachedRootCapability,
  isAgentFullAccessEnabled,
  setAgentFullAccessEnabled,
  setAgentWorkingDirectory,
} from './agent-broker'

describe('Android Agent Tool Broker', () => {
  beforeAll(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
  })

  beforeEach(() => {
    localStorage.clear()
    clearCachedRootCapability()
  })

  it('keeps a successful Root capability across app reload state', async () => {
    localStorage.setItem('yachiyo-agent-root-capability-v1', JSON.stringify({ available: true, detail: 'KernelSU' }))
    expect(getCachedRootCapability()).toEqual({ available: true, detail: 'KernelSU' })
  })

  it('persists the explicit full access setting', () => {
    expect(isAgentFullAccessEnabled()).toBe(false)
    setAgentFullAccessEnabled(true)
    expect(isAgentFullAccessEnabled()).toBe(true)
  })

  it('denies root commands while full access is disabled', async () => {
    const result = await executeRootShell('id')
    expect(result.exitCode).toBe(126)
    expect(result.stderr).toContain('未启用')
  })

  it('persists a selected working directory and keeps the default as fallback', () => {
    expect(getAgentWorkingDirectory()).toBe(ANDROID_AGENT_WORKING_DIRECTORY)
    setAgentWorkingDirectory('/storage/emulated/0/Yachiyo Claw/')
    expect(getAgentWorkingDirectory()).toBe('/storage/emulated/0/Yachiyo Claw')
  })

  it('rejects non-absolute working directories', () => {
    expect(() => setAgentWorkingDirectory('relative/path')).toThrow('invalid_working_directory')
  })
})
