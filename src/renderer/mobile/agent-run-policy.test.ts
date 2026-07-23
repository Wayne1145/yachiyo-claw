import { describe, expect, it } from 'vitest'
import { createAgentRunId, shouldUseDeviceAgent } from './agent-run-policy'

describe('agent run policy', () => {
  it('applies device budgets only when phone control is enabled on mobile', () => {
    expect(shouldUseDeviceAgent('mobile', false)).toBe(false)
    expect(shouldUseDeviceAgent('mobile', true)).toBe(true)
    expect(shouldUseDeviceAgent('desktop', true)).toBe(false)
  })

  it('scopes persisted usage to one assistant generation', () => {
    expect(createAgentRunId('conversation-1', 'reply-1')).toBe('conversation-1:reply-1')
    expect(createAgentRunId('conversation-1', 'reply-2')).not.toBe(createAgentRunId('conversation-1', 'reply-1'))
  })
})
