import { describe, expect, it } from 'vitest'
import {
  buildAgentRecoveryContext,
  canResumeAgentStreamAfterTools,
  describeAgentStreamError,
  getAgentRetryDelayMs,
  isTransientAgentStreamError,
} from './agent-stream-retry'

describe('isTransientAgentStreamError', () => {
  it.each([
    new Error('EOFException'),
    new Error('connection reset'),
    new Error('stream terminated'),
    new Error('Our servers are currently overloaded. Please try again later.'),
    'TypeError: Failed to fetch',
  ])('accepts recoverable first-request transport failures', (error) => {
    expect(isTransientAgentStreamError(error)).toBe(true)
  })

  it('backs off successive recovery attempts', () => {
    expect(getAgentRetryDelayMs(0)).toBe(1_500)
    expect(getAgentRetryDelayMs(1)).toBe(3_000)
  })

  it.each([new Error('Status Code 401'), new Error('Invalid tool input'), new Error('sandbox_write_failed')])(
    'does not retry deterministic failures',
    (error) => {
      expect(isTransientAgentStreamError(error)).toBe(false)
    },
  )

  it('finds transport failures nested in native bridge error objects', () => {
    const error = { status: 503, error: { code: 'EOFException', message: 'stream truncated' } }
    expect(describeAgentStreamError(error)).toContain('EOFException')
    expect(isTransientAgentStreamError(error)).toBe(true)
  })

  it('resumes only when every emitted tool call is settled', () => {
    expect(
      canResumeAgentStreamAfterTools(2, {
        contentParts: [
          { type: 'tool-call', state: 'result' },
          { type: 'tool-call', state: 'error' },
        ],
      })
    ).toBe(true)
    expect(canResumeAgentStreamAfterTools(2, { contentParts: [{ type: 'tool-call', state: 'call' }] })).toBe(false)
    expect(canResumeAgentStreamAfterTools(0, { contentParts: [{ type: 'tool-call', state: 'result' }] })).toBe(false)
  })

  it('replaces an older partial response in recovery context', () => {
    const partial: { id: string; contentParts?: Array<{ type?: string; state?: string }> } = {
      id: 'assistant',
      contentParts: [{ type: 'tool-call', state: 'result' }],
    }
    expect(buildAgentRecoveryContext([{ id: 'user' }, { id: 'assistant' }], partial)).toEqual([
      { id: 'user' },
      partial,
    ])
  })
})
