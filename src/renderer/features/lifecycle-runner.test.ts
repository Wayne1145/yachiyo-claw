import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginAgentRun,
  registerFeatureLifecycle,
  resetFeatureLifecycleRegistry,
  runFeatureInit,
} from './lifecycle-runner'

afterEach(resetFeatureLifecycleRegistry)

const runContext = () => ({
  agentRunId: 'run-1',
  taskId: 'task-1',
  abortSignal: new AbortController().signal,
  requestAbort: vi.fn(),
  featureOptions: {},
})

describe('feature lifecycle runner', () => {
  it('cleans up in reverse order and dispose is idempotent', async () => {
    const calls: string[] = []
    registerFeatureLifecycle({
      featureId: 'one',
      onAgentRunStart: () => () => {
        calls.push('one')
      },
    })
    registerFeatureLifecycle({
      featureId: 'two',
      onAgentRunStart: () => () => {
        calls.push('two')
      },
    })
    const handle = await beginAgentRun(runContext(), new Set(['one', 'two']))
    await handle.disposeAll()
    await handle.disposeAll()
    expect(calls).toEqual(['two', 'one'])
  })

  it('runs every cleanup before reporting aggregate failures', async () => {
    const cleanup = vi.fn()
    registerFeatureLifecycle({
      featureId: 'one',
      onAgentRunStart: () => () => {
        throw new Error('one')
      },
    })
    registerFeatureLifecycle({ featureId: 'two', onAgentRunStart: () => cleanup })
    const handle = await beginAgentRun(runContext(), new Set(['one', 'two']))
    await expect(handle.disposeAll()).rejects.toBeInstanceOf(AggregateError)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('isolates init failures', async () => {
    const second = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerFeatureLifecycle({
      featureId: 'one',
      init: () => {
        throw new Error('no')
      },
    })
    registerFeatureLifecycle({ featureId: 'two', init: second })
    expect(await runFeatureInit(new Set(['one', 'two']))).toEqual(['one'])
    expect(second).toHaveBeenCalledOnce()
  })
})
