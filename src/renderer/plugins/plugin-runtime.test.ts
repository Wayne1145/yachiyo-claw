import type { JsonValue } from '@shared/agent/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createPluginSandbox, type PluginEntryEvaluator } from './plugin-sandbox'
import { type HostApi, type HostCallAuthorizer, PluginRuntime } from './plugin-runtime'
import { PLUGIN_RPC_PROTOCOL_VERSION, type Transport } from './rpc-protocol'

/** A pair of transports that deliver each other's messages asynchronously, standing in for a Worker. */
function linkedTransports(): { host: Transport; worker: Transport } {
  let hostHandlers: ((message: unknown) => void)[] = []
  let workerHandlers: ((message: unknown) => void)[] = []
  const deliver = (handlers: ((message: unknown) => void)[], message: unknown) =>
    queueMicrotask(() => handlers.slice().forEach((handler) => handler(message)))
  return {
    host: {
      post: (message) => deliver(workerHandlers, message),
      subscribe: (handler) => {
        hostHandlers.push(handler)
        return () => {
          hostHandlers = hostHandlers.filter((existing) => existing !== handler)
        }
      },
      terminate: () => {
        hostHandlers = []
      },
    },
    worker: {
      post: (message) => deliver(hostHandlers, message),
      subscribe: (handler) => {
        workerHandlers.push(handler)
        return () => {
          workerHandlers = workerHandlers.filter((existing) => existing !== handler)
        }
      },
      terminate: () => {
        workerHandlers = []
      },
    },
  }
}

function setup(
  evaluate: PluginEntryEvaluator,
  options: { hostApi?: HostApi; authorize?: HostCallAuthorizer } = {}
): PluginRuntime {
  const { host, worker } = linkedTransports()
  createPluginSandbox(worker, evaluate)
  return new PluginRuntime(host, {
    hostApi: options.hostApi ?? {},
    authorize: options.authorize ?? (() => ({ allowed: false, reason: 'capability_denied' })),
  })
}

// A representative plugin entry: an echo tool and a storage-backed tool that calls the host.
const demoPlugin: PluginEntryEvaluator = (_entry, api) => {
  api.registerTool('demo_echo', (args) => ({ echoed: args }))
  api.registerTool('demo_store', async (args) => {
    await api.host.call('storage.set', args)
    return api.host.call('storage.get', {})
  })
}

describe('plugin runtime end-to-end (isolate protocol)', () => {
  it('forwards bounded plugin logs to the host observer', async () => {
    const logs: Array<{ level: string; message: string }> = []
    const { host, worker } = linkedTransports()
    createPluginSandbox(worker, (_entry, api) => {
      api.log('warn', 'plugin diagnostic')
      api.registerTool('ok', () => null)
    })
    const runtime = new PluginRuntime(host, {
      hostApi: {},
      authorize: () => ({ allowed: false, reason: 'denied' }),
      onLog: (entry) => logs.push(entry),
    })
    await runtime.load('p', '')
    expect(logs).toEqual([{ level: 'warn', message: 'plugin diagnostic' }])
  })

  it('loads a plugin and reports its registered tools', async () => {
    const runtime = setup(demoPlugin)
    const tools = await runtime.load('demo', 'ignored-in-test')
    expect(tools.map((tool) => tool.name).sort()).toEqual(['demo_echo', 'demo_store'])
  })

  it('rejects an incompatible worker protocol during the ready handshake', async () => {
    let hostHandler: ((message: unknown) => void) | undefined
    const transport: Transport = {
      post: (message) => {
        if ((message as { type?: string }).type === 'load') {
          queueMicrotask(() =>
            hostHandler?.({ type: 'ready', protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION + 1, tools: [] })
          )
        }
      },
      subscribe: (handler) => {
        hostHandler = handler
        return () => {
          hostHandler = undefined
        }
      },
      terminate: vi.fn(),
    }
    const runtime = new PluginRuntime(transport, {
      hostApi: {},
      authorize: () => ({ allowed: false, reason: 'denied' }),
    })

    await expect(runtime.load('demo', '')).rejects.toThrow('plugin_protocol_incompatible')
    expect(runtime.isDisposed()).toBe(true)
  })

  it('rejects an incompatible host protocol before evaluating plugin code', async () => {
    const pair = linkedTransports()
    const evaluate = vi.fn()
    const messages: unknown[] = []
    pair.host.subscribe((message) => messages.push(message))
    createPluginSandbox(pair.worker, evaluate)

    pair.host.post({ type: 'load', protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION + 1, pluginId: 'demo', entry: '' })

    await vi.waitFor(() =>
      expect(messages).toContainEqual({ type: 'load-error', error: 'plugin_protocol_incompatible' })
    )
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('round-trips a tool invocation with pure data', async () => {
    const runtime = setup(demoPlugin)
    await runtime.load('demo', '')
    expect(await runtime.invokeTool('demo_echo', { msg: 'hi' })).toEqual({ echoed: { msg: 'hi' } })
  })

  it('routes an authorized host call through the whitelist', async () => {
    let stored: JsonValue = null
    const runtime = setup(demoPlugin, {
      authorize: (method) =>
        method.startsWith('storage.') ? { allowed: true } : { allowed: false, reason: 'capability_denied' },
      hostApi: {
        'storage.set': (args) => {
          stored = args
          return { ok: true }
        },
        'storage.get': () => stored,
      },
    })
    await runtime.load('demo', '')
    expect(await runtime.invokeTool('demo_store', { k: 1 })).toEqual({ k: 1 })
  })

  it('denies an unauthorized host call (default-deny)', async () => {
    const runtime = setup(demoPlugin, { hostApi: { 'storage.set': () => ({ ok: true }), 'storage.get': () => null } })
    await runtime.load('demo', '')
    await expect(runtime.invokeTool('demo_store', { k: 1 })).rejects.toThrow('capability_denied')
  })

  it('rejects an authorized-but-unknown host method without a generic invoke', async () => {
    const runtime = setup((_entry, api) => api.registerTool('t', async () => api.host.call('secrets.read', {})), {
      authorize: () => ({ allowed: true }),
      hostApi: {},
    })
    await runtime.load('p', '')
    await expect(runtime.invokeTool('t', {})).rejects.toThrow('method_not_found')
  })

  it('rejects an unknown tool', async () => {
    const runtime = setup(demoPlugin)
    await runtime.load('demo', '')
    await expect(runtime.invokeTool('nope', {})).rejects.toThrow('tool_not_found')
  })

  it('times out a hanging tool', async () => {
    const runtime = setup((_entry, api) => api.registerTool('hang', () => new Promise<JsonValue>(() => {})))
    await runtime.load('p', '')
    await expect(runtime.invokeTool('hang', {}, 30)).rejects.toThrow('timeout')
  })

  it('surfaces a load failure as a rejected load', async () => {
    const runtime = setup(() => {
      throw new Error('bad_entry')
    })
    await expect(runtime.load('p', '')).rejects.toThrow('bad_entry')
  })

  it('rejects duplicate tool registrations and non-JSON or oversized results', async () => {
    const duplicate = setup((_entry, api) => {
      api.registerTool('same', () => null)
      api.registerTool('same', () => null)
    })
    await expect(duplicate.load('p', '')).rejects.toThrow('duplicate_tool_registration')

    const invalid = setup((_entry, api) => api.registerTool('invalid', () => BigInt(1) as never))
    await invalid.load('p', '')
    await expect(invalid.invokeTool('invalid', {})).rejects.toThrow('invalid_plugin_json')

    const oversized = setup((_entry, api) => api.registerTool('large', () => 'x'.repeat(1024 * 1024 + 1)))
    await oversized.load('p', '')
    await expect(oversized.invokeTool('large', {})).rejects.toThrow('plugin_payload_too_large')
  })

  it('times out a hanging load and terminates the isolate', async () => {
    vi.useFakeTimers()
    try {
      const { host, worker } = linkedTransports()
      createPluginSandbox(worker, () => new Promise<void>(() => {}))
      const runtime = new PluginRuntime(host, {
        hostApi: {},
        authorize: () => ({ allowed: false, reason: 'capability_denied' }),
        loadTimeoutMs: 25,
      })
      const loading = runtime.load('p', '')
      const rejected = expect(loading).rejects.toThrow('load_timeout')
      await vi.advanceTimersByTimeAsync(25)
      await rejected
      await expect(runtime.invokeTool('x', {})).rejects.toThrow('disposed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a load waiter when disposed and returns registered tools on repeat load', async () => {
    const runtime = setup(demoPlugin)
    const first = await runtime.load('demo', '')
    expect(await runtime.load('demo', '')).toEqual(first)

    const { host, worker } = linkedTransports()
    createPluginSandbox(worker, () => new Promise<void>(() => {}))
    const pendingRuntime = new PluginRuntime(host, { hostApi: {}, authorize: () => ({ allowed: true }) })
    const pending = pendingRuntime.load('p', '')
    pendingRuntime.dispose()
    await expect(pending).rejects.toThrow('disposed')
  })

  it('enforces invocation concurrency and disposes an idle runtime', async () => {
    const { host, worker } = linkedTransports()
    createPluginSandbox(worker, (_entry, api) => api.registerTool('hang', () => new Promise<JsonValue>(() => {})))
    const runtime = new PluginRuntime(host, {
      hostApi: {},
      authorize: () => ({ allowed: true }),
      maxConcurrentInvocations: 1,
    })
    await runtime.load('p', '')
    const hanging = runtime.invokeTool('hang', {}, 1_000)
    await expect(runtime.invokeTool('hang', {}, 1_000)).rejects.toThrow('too_many_concurrent_invocations')
    runtime.dispose()
    await expect(hanging).rejects.toThrow('disposed')

    vi.useFakeTimers()
    try {
      let idled = false
      const pair = linkedTransports()
      createPluginSandbox(pair.worker, demoPlugin)
      const idleRuntime = new PluginRuntime(pair.host, {
        hostApi: {},
        authorize: () => ({ allowed: true }),
        idleTimeoutMs: 20,
        onIdle: () => {
          idled = true
        },
      })
      await idleRuntime.load('p', '')
      await vi.advanceTimersByTimeAsync(20)
      expect(idled).toBe(true)
      await expect(idleRuntime.invokeTool('demo_echo', {})).rejects.toThrow('disposed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('defaults to one invocation because the Worker binds host calls to one active principal', async () => {
    const runtime = setup((_entry, api) => api.registerTool('hang', () => new Promise<JsonValue>(() => {})))
    await runtime.load('p', '')
    const hanging = runtime.invokeTool('hang', {}, 1_000)
    await expect(runtime.invokeTool('hang', {}, 1_000)).rejects.toThrow('too_many_concurrent_invocations')
    runtime.dispose()
    await expect(hanging).rejects.toThrow('disposed')
  })

  it('finishes a fire-and-forget host call before completing its invocation', async () => {
    let releaseHostCall: (() => void) | undefined
    let hostCallStarted = false
    const runtime = setup(
      (_entry, api) =>
        api.registerTool('fire_and_forget', () => {
          void api.host.call('storage.set', { key: 'value' })
          return { ok: true }
        }),
      {
        authorize: () => ({ allowed: true }),
        hostApi: {
          'storage.set': async () => {
            hostCallStarted = true
            await new Promise<void>((resolve) => {
              releaseHostCall = resolve
            })
            return { stored: true }
          },
        },
      }
    )
    await runtime.load('p', '')
    let invocationSettled = false
    const invocation = runtime.invokeTool('fire_and_forget', {}).finally(() => {
      invocationSettled = true
    })
    await vi.waitFor(() => expect(hostCallStarted).toBe(true))
    expect(invocationSettled).toBe(false)
    releaseHostCall?.()
    await expect(invocation).resolves.toEqual({ ok: true })
  })

  it('binds every host call to the active invocation and propagates its principal context', async () => {
    const principal = { kind: 'plugin' as const, pluginId: 'demo', entrySha256: 'a'.repeat(64) }
    const authorize = vi.fn(() => ({ allowed: true as const }))
    const hostCall = vi.fn(() => ({ ok: true }))
    const runtime = setup((_entry, api) => api.registerTool('bound', (args) => api.host.call('storage.set', args)), {
      authorize,
      hostApi: { 'storage.set': hostCall },
    })
    await runtime.load('demo', '')

    await expect(
      runtime.invokeTool('bound', { key: 'value' }, 1_000, {
        principal,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-call-1',
      })
    ).resolves.toEqual({ ok: true })
    expect(authorize).toHaveBeenCalledWith(
      'storage.set',
      { key: 'value' },
      expect.objectContaining({
        principal,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        hostCallId: 'h0',
      })
    )
    expect(hostCall).toHaveBeenCalledWith(
      { key: 'value' },
      expect.objectContaining({ principal, sessionId: 'session-1', runId: 'run-1', toolCallId: 'tool-call-1' })
    )
  })

  it('restarts host-call ordinals for deterministic Broker checkpoints on tool retry', async () => {
    const hostCallIds: string[] = []
    const runtime = setup((_entry, api) => api.registerTool('bound', (args) => api.host.call('storage.set', args)), {
      authorize: (_method, _args, context) => {
        hostCallIds.push(context.hostCallId)
        return { allowed: true }
      },
      hostApi: { 'storage.set': () => ({ ok: true }) },
    })
    await runtime.load('demo', '')

    await runtime.invokeTool('bound', { value: 1 })
    await runtime.invokeTool('bound', { value: 1 })

    expect(hostCallIds).toEqual(['h0', 'h0'])
  })

  it('rejects missing or forged invocation ids before authorization or host dispatch', async () => {
    const pair = linkedTransports()
    createPluginSandbox(pair.worker, (_entry, api) => api.registerTool('hang', () => new Promise<JsonValue>(() => {})))
    const authorize = vi.fn(() => ({ allowed: true as const }))
    const hostCall = vi.fn(() => ({ ok: true }))
    const hostMessages: unknown[] = []
    pair.worker.subscribe((message) => hostMessages.push(message))
    const runtime = new PluginRuntime(pair.host, {
      authorize,
      hostApi: { 'storage.get': hostCall },
    })
    await runtime.load('demo', '')
    const invocation = runtime.invokeTool('hang', {}, 1_000)

    pair.worker.post({
      type: 'host-call',
      callId: 'forged-one',
      invocationId: 'c999',
      method: 'storage.get',
      args: {},
    })
    pair.worker.post({
      type: 'host-call',
      callId: 'forged-two',
      method: 'storage.get',
      args: {},
    })
    await vi.waitFor(() => {
      expect(hostMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'host-result', callId: 'forged-one', error: 'host_call_outside_invocation' }),
          expect.objectContaining({ type: 'host-result', callId: 'forged-two', error: 'host_call_outside_invocation' }),
        ])
      )
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(hostCall).not.toHaveBeenCalled()
    runtime.dispose()
    await expect(invocation).rejects.toThrow('disposed')
  })

  it('aborts an in-flight host operation when its runtime is revoked or disposed', async () => {
    let hostStarted = false
    let hostSignalAborted = false
    const runtime = setup(
      (_entry, api) => api.registerTool('long_host_call', () => api.host.call('sandbox.exec', { command: 'work' })),
      {
        authorize: () => ({ allowed: true }),
        hostApi: {
          'sandbox.exec': (_args, context) =>
            new Promise<JsonValue>((_resolve, reject) => {
              hostStarted = true
              context.signal.addEventListener(
                'abort',
                () => {
                  hostSignalAborted = true
                  reject(new Error('cancelled'))
                },
                { once: true }
              )
            }),
        },
      }
    )
    await runtime.load('demo', '')
    const invocation = runtime.invokeTool('long_host_call', {}, 1_000)
    await vi.waitFor(() => expect(hostStarted).toBe(true))

    runtime.dispose()
    await expect(invocation).rejects.toThrow('disposed')
    expect(hostSignalAborted).toBe(true)
  })
})
