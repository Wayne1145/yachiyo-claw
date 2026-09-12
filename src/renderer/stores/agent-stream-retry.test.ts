import { describe, expect, it } from 'vitest'
import { isTransientAgentStreamError } from './agent-stream-retry'

describe('isTransientAgentStreamError', () => {
  it.each([
    new Error('EOFException'),
    new Error('connection reset'),
    new Error('stream terminated'),
    'TypeError: Failed to fetch',
  ])('accepts recoverable first-request transport failures', (error) => {
    expect(isTransientAgentStreamError(error)).toBe(true)
  })

  it.each([new Error('Status Code 401'), new Error('Invalid tool input'), new Error('sandbox_write_failed')])(
    'does not retry deterministic failures',
    (error) => {
      expect(isTransientAgentStreamError(error)).toBe(false)
    },
  )
})
