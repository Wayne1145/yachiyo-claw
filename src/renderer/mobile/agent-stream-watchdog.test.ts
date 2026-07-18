import { describe, expect, it, vi } from 'vitest'
import { nextAgentStreamPart } from './agent-stream-watchdog'

describe('agent stream watchdog', () => {
  it('returns the next part before the timeout', async () => {
    const iterator = (async function* () {
      yield 1
    })()
    await expect(nextAgentStreamPart(iterator, 100, vi.fn())).resolves.toEqual({ value: 1, done: false })
  })

  it('aborts and rejects when the stream stops making progress', async () => {
    const onTimeout = vi.fn()
    const iterator: AsyncIterator<number> = { next: () => new Promise(() => undefined) }
    await expect(nextAgentStreamPart(iterator, 5, onTimeout)).rejects.toThrow('agent_stream_idle_timeout')
    expect(onTimeout).toHaveBeenCalledOnce()
  })
})
