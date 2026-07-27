import type { JsonValue } from '@shared/agent/contracts'
import {
  type HostToWorkerMessage,
  PLUGIN_RPC_PROTOCOL_VERSION,
  sanitizeError,
  type Transport,
  type WorkerToHostMessage,
} from './rpc-protocol'

/**
 * Worker-side plugin sandbox (platform-21).
 *
 * Runs inside the isolate. The only thing the plugin entry receives is `PluginApi` — a small set of
 * pure-data functions. It registers tools and may call whitelisted host methods; every host call is
 * authorized on the host side, never here. The `evaluate` hook is injected so tests can drive the
 * sandbox without a real Worker; the Blob adapter passes a real evaluator.
 */

export interface PluginApi {
  registerTool(name: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): void
  host: { call(method: string, args: JsonValue): Promise<JsonValue> }
  log(level: 'log' | 'warn' | 'error', message: string): void
}

export type PluginEntryEvaluator = (entry: string, api: PluginApi) => void | Promise<void>

export function createPluginSandbox(transport: Transport, evaluate: PluginEntryEvaluator): void {
  const tools = new Map<string, (args: JsonValue) => JsonValue | Promise<JsonValue>>()
  const pendingHostCalls = new Map<string, { resolve: (value: JsonValue) => void; reject: (error: Error) => void }>()
  let hostCallSeq = 0
  let currentInvocationId = ''
  const post = (message: WorkerToHostMessage) => transport.post(message)

  const api: PluginApi = {
    registerTool(name, handler) {
      if (
        typeof name !== 'string' ||
        name.length > 160 ||
        !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name) ||
        typeof handler !== 'function'
      ) {
        throw new Error('invalid_tool_registration')
      }
      if (tools.has(name)) throw new Error('duplicate_tool_registration')
      if (tools.size >= 64) throw new Error('tool_registration_limit')
      tools.set(name, handler)
    },
    host: {
      call(method, args) {
        return new Promise<JsonValue>((resolve, reject) => {
          if (!currentInvocationId) {
            reject(new Error('host_call_outside_invocation'))
            return
          }
          const callId = `h${hostCallSeq++}`
          pendingHostCalls.set(callId, { resolve, reject })
          post({ type: 'host-call', callId, invocationId: currentInvocationId, method, args })
        })
      },
    },
    log(level, message) {
      if (!['log', 'warn', 'error'].includes(level) || typeof message !== 'string') {
        throw new Error('invalid_plugin_log')
      }
      post({ type: 'log', level, message: message.slice(0, 4_000) })
    },
  }

  transport.subscribe(async (raw) => {
    const message = raw as HostToWorkerMessage
    switch (message.type) {
      case 'load':
        if (message.protocolVersion !== PLUGIN_RPC_PROTOCOL_VERSION) {
          post({ type: 'load-error', error: 'plugin_protocol_incompatible' })
          break
        }
        try {
          await evaluate(message.entry, api)
          post({
            type: 'ready',
            protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
            tools: [...tools.keys()].map((name) => ({ name, description: name })),
          })
        } catch (error) {
          post({ type: 'load-error', error: sanitizeError(error) })
        }
        break
      case 'invoke': {
        const handler = tools.get(message.name)
        if (!handler) {
          post({ type: 'error', callId: message.callId, error: 'tool_not_found' })
          break
        }
        try {
          currentInvocationId = message.callId
          // Host-call ordinals restart per model tool call so Broker checkpoint ids remain stable on retry.
          hostCallSeq = 0
          const value = await handler(message.args)
          post({ type: 'result', callId: message.callId, value })
        } catch (error) {
          post({ type: 'error', callId: message.callId, error: sanitizeError(error) })
        } finally {
          if (currentInvocationId === message.callId) currentInvocationId = ''
        }
        break
      }
      case 'host-result': {
        const pending = pendingHostCalls.get(message.callId)
        if (!pending) break
        pendingHostCalls.delete(message.callId)
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new Error(message.error))
        break
      }
    }
  })
}
