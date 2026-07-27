import { JsonValueSchema, type AgentPrincipal, type JsonValue } from '@shared/agent/contracts'
import {
  type PluginToolMeta,
  PLUGIN_RPC_PROTOCOL_VERSION,
  sanitizeError,
  type Transport,
  type WorkerToHostMessage,
} from './rpc-protocol'

/**
 * Host-side plugin runtime (platform-21).
 * 运行在宿主侧的插件运行时。
 *
 * Owns the trusted half of the boundary. It loads a plugin into the isolate, invokes its tools with a
 * timeout, and — crucially — is the single place a plugin's host call is authorized (default-deny) and
 * dispatched against an explicit method whitelist. There is deliberately no generic `invoke(method)`
 * entry: an un-whitelisted method is rejected, and host errors are sanitized before crossing back.
 */

export interface PluginInvocationContext {
  principal?: AgentPrincipal
  sessionId?: string
  runId?: string
  toolCallId?: string
  abortSignal?: AbortSignal
}

export interface PluginHostCallContext extends Omit<PluginInvocationContext, 'abortSignal'> {
  /** Stable within one plugin invocation and included in Broker checkpoint derivation. */
  /** 在单次插件调用内稳定，并参与 Broker 检查点派生。 */
  hostCallId: string
  signal: AbortSignal
}

/** Explicit, named host method whitelist. Values receive/return pure data only. */
/** 显式列出的宿主方法白名单；仅接收和返回纯数据。 */
export type HostApi = Record<
  string,
  (args: JsonValue, context: PluginHostCallContext) => JsonValue | Promise<JsonValue>
>

/** Capability gate for a host method. Returns allow/deny; anything uncertain must deny. */
/** 宿主方法的能力门禁；不确定时必须拒绝。 */
export type HostCallAuthorizer = (
  method: string,
  args: JsonValue,
  context: PluginHostCallContext
) =>
  | { allowed: true }
  | { allowed: false; reason: string }
  | Promise<{ allowed: true } | { allowed: false; reason: string }>

export interface PluginRuntimeOptions {
  hostApi: HostApi
  authorize: HostCallAuthorizer
  defaultTimeoutMs?: number
  loadTimeoutMs?: number
  idleTimeoutMs?: number
  maxConcurrentInvocations?: number
  onIdle?: () => void
  onLog?: (entry: { level: 'log' | 'warn' | 'error'; message: string }) => void
}

export class PluginRuntime {
  private unsubscribe: () => void = () => {}
  private readonly invocations = new Map<
    string,
    {
      resolve: (value: JsonValue) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
      controller: AbortController
      context: PluginInvocationContext
      detachAbort: () => void
    }
  >()
  private loadWaiter: {
    resolve: (tools: PluginToolMeta[]) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private tools: PluginToolMeta[] | null = null
  private disposed = false
  private callSeq = 0
  private messageQueue: Promise<void> = Promise.resolve()
  private queuedMessages = 0

  constructor(
    private readonly transport: Transport,
    private readonly options: PluginRuntimeOptions
  ) {
    const unsubscribe = transport.subscribe((raw) => {
      if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
        this.dispose()
        return
      }
      // Preserve Worker message order while a host call awaits native I/O. Otherwise a plugin that
      // 宿主调用等待原生 I/O 时仍须保持 Worker 消息顺序，避免未 await 的调用抢先结束。
      // forgets to await host.call() can finish its invocation before that call is authorized.
      if (++this.queuedMessages > 256) {
        this.dispose()
        return
      }
      this.messageQueue = this.messageQueue
        .then(() => this.onMessage(raw as WorkerToHostMessage))
        .catch(() => this.dispose())
        .finally(() => {
          this.queuedMessages--
        })
    })
    this.unsubscribe = unsubscribe
    if (this.disposed) unsubscribe()
  }

  load(pluginId: string, entry: string): Promise<PluginToolMeta[]> {
    if (this.disposed) return Promise.reject(new Error('disposed'))
    if (this.tools) return Promise.resolve([...this.tools])
    if (this.loadWaiter) return Promise.reject(new Error('load_in_progress'))
    return new Promise<PluginToolMeta[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.loadWaiter) return
        this.loadWaiter = null
        reject(new Error('load_timeout'))
        // A timed-out evaluator may still be running. Terminate the isolate instead of abandoning it.
        // 超时的执行器可能仍在运行，必须终止隔离环境而非放任其继续。
        this.dispose()
      }, this.options.loadTimeoutMs ?? 10_000)
      this.loadWaiter = { resolve, reject, timer }
      try {
        this.transport.post({ type: 'load', protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION, pluginId, entry })
      } catch (error) {
        clearTimeout(timer)
        this.loadWaiter = null
        reject(error instanceof Error ? error : new Error('load_transport_failed'))
      }
    })
  }

  invokeTool(
    name: string,
    args: JsonValue,
    timeoutMs = this.options.defaultTimeoutMs ?? 10_000,
    context: PluginInvocationContext = {}
  ): Promise<JsonValue> {
    if (this.disposed) return Promise.reject(new Error('disposed'))
    if (!this.tools) return Promise.reject(new Error('plugin_not_loaded'))
    if (context.abortSignal?.aborted) return Promise.reject(new Error('cancelled'))
    if (this.invocations.size >= (this.options.maxConcurrentInvocations ?? 1)) {
      return Promise.reject(new Error('too_many_concurrent_invocations'))
    }
    this.clearIdleTimer()
    return new Promise<JsonValue>((resolve, reject) => {
      const callId = `c${this.callSeq++}`
      const controller = new AbortController()
      const abort = () => {
        const pending = this.invocations.get(callId)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.detachAbort()
        pending.controller.abort()
        this.invocations.delete(callId)
        pending.reject(new Error('cancelled'))
        this.dispose()
      }
      context.abortSignal?.addEventListener('abort', abort, { once: true })
      const detachAbort = () => context.abortSignal?.removeEventListener('abort', abort)
      const timer = setTimeout(() => {
        const pending = this.invocations.get(callId)
        if (!pending) return
        this.invocations.delete(callId)
        pending.detachAbort()
        pending.controller.abort()
        reject(new Error('timeout'))
        // Do not let a timed-out handler keep consuming CPU or issuing host calls.
        // 不允许超时处理器继续占用 CPU 或发起宿主调用。
        this.dispose()
      }, timeoutMs)
      this.invocations.set(callId, { resolve, reject, timer, controller, context, detachAbort })
      try {
        this.transport.post({ type: 'invoke', callId, name, args })
      } catch (error) {
        clearTimeout(timer)
        detachAbort()
        this.invocations.delete(callId)
        reject(error instanceof Error ? error : new Error('invoke_transport_failed'))
        this.scheduleIdle()
      }
    })
  }

  getRegisteredTools(): PluginToolMeta[] {
    return this.tools ? [...this.tools] : []
  }

  isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearIdleTimer()
    this.unsubscribe()
    if (this.loadWaiter) {
      clearTimeout(this.loadWaiter.timer)
      this.loadWaiter.reject(new Error('disposed'))
      this.loadWaiter = null
    }
    for (const pending of this.invocations.values()) {
      clearTimeout(pending.timer)
      pending.detachAbort()
      pending.controller.abort()
      pending.reject(new Error('disposed'))
    }
    this.invocations.clear()
    this.transport.terminate()
  }

  private async onMessage(message: WorkerToHostMessage): Promise<void> {
    if (this.disposed) return
    switch (message.type) {
      case 'ready':
        if (!this.loadWaiter) break
        if (message.protocolVersion !== PLUGIN_RPC_PROTOCOL_VERSION) {
          clearTimeout(this.loadWaiter.timer)
          this.loadWaiter.reject(new Error('plugin_protocol_incompatible'))
          this.loadWaiter = null
          this.dispose()
          break
        }
        if (!this.validateTools(message.tools)) {
          clearTimeout(this.loadWaiter.timer)
          this.loadWaiter.reject(new Error('invalid_registered_tools'))
          this.loadWaiter = null
          this.dispose()
          break
        }
        clearTimeout(this.loadWaiter.timer)
        this.tools = [...message.tools]
        this.loadWaiter.resolve([...message.tools])
        this.loadWaiter = null
        this.scheduleIdle()
        break
      case 'load-error':
        if (!this.loadWaiter) break
        clearTimeout(this.loadWaiter.timer)
        this.loadWaiter.reject(new Error(message.error))
        this.loadWaiter = null
        break
      case 'result': {
        const pending = this.invocations.get(message.callId)
        if (!pending) break
        clearTimeout(pending.timer)
        pending.detachAbort()
        this.invocations.delete(message.callId)
        try {
          pending.resolve(this.validateJson(message.value))
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error('invalid_plugin_result'))
        }
        this.scheduleIdle()
        break
      }
      case 'error': {
        const pending = this.invocations.get(message.callId)
        if (!pending) break
        clearTimeout(pending.timer)
        pending.detachAbort()
        this.invocations.delete(message.callId)
        pending.reject(new Error(message.error))
        this.scheduleIdle()
        break
      }
      case 'host-call':
        await this.handleHostCall(message.callId, message.invocationId, message.method, message.args)
        break
      case 'log':
        if (
          (message.level === 'log' || message.level === 'warn' || message.level === 'error') &&
          typeof message.message === 'string' &&
          message.message.length <= 4_000
        ) {
          this.options.onLog?.({ level: message.level, message: message.message })
        }
        break
    }
  }

  private async handleHostCall(callId: string, invocationId: string, method: string, args: JsonValue): Promise<void> {
    if (this.disposed) return
    if (typeof callId !== 'string' || callId.length > 80 || typeof method !== 'string' || method.length > 120) {
      this.transport.post({
        type: 'host-result',
        callId: typeof callId === 'string' ? callId.slice(0, 80) : '',
        ok: false,
        error: 'invalid_host_call',
      })
      return
    }
    const invocation = this.invocations.get(invocationId)
    if (!invocation) {
      this.transport.post({
        type: 'host-result',
        callId,
        ok: false,
        error: 'host_call_outside_invocation',
      })
      return
    }
    const context: PluginHostCallContext = {
      principal: invocation.context.principal,
      sessionId: invocation.context.sessionId,
      runId: invocation.context.runId,
      toolCallId: invocation.context.toolCallId,
      hostCallId: callId,
      signal: invocation.controller.signal,
    }
    let validatedArgs: JsonValue
    try {
      validatedArgs = this.validateJson(args)
    } catch {
      this.transport.post({ type: 'host-result', callId, ok: false, error: 'invalid_host_call_args' })
      return
    }
    let decision: { allowed: true } | { allowed: false; reason: string }
    try {
      decision = await this.options.authorize(method, validatedArgs, context)
    } catch {
      decision = { allowed: false, reason: 'authorization_failed' }
    }
    if (this.disposed || context.signal.aborted || this.invocations.get(invocationId) !== invocation) return
    if (!decision.allowed) {
      this.transport.post({ type: 'host-result', callId, ok: false, error: decision.reason })
      return
    }
    const fn = Object.prototype.hasOwnProperty.call(this.options.hostApi, method)
      ? this.options.hostApi[method]
      : undefined
    if (!fn) {
      this.transport.post({ type: 'host-result', callId, ok: false, error: 'method_not_found' })
      return
    }
    try {
      const value = this.validateJson(await fn(validatedArgs, context))
      if (this.disposed || context.signal.aborted || this.invocations.get(invocationId) !== invocation) return
      this.transport.post({ type: 'host-result', callId, ok: true, value })
    } catch (error) {
      if (this.disposed || context.signal.aborted || this.invocations.get(invocationId) !== invocation) return
      this.transport.post({ type: 'host-result', callId, ok: false, error: sanitizeError(error) })
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private validateJson(value: unknown): JsonValue {
    let serialized: string
    try {
      serialized = JSON.stringify(value)
    } catch {
      throw new Error('invalid_plugin_json')
    }
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 1024 * 1024) {
      throw new Error('plugin_payload_too_large')
    }
    const parsed: unknown = JSON.parse(serialized)
    const result = JsonValueSchema.safeParse(parsed)
    if (!result.success) throw new Error('invalid_plugin_json')
    return result.data
  }

  private validateTools(tools: PluginToolMeta[]): boolean {
    if (!Array.isArray(tools) || tools.length > 64) return false
    const names = new Set<string>()
    for (const tool of tools) {
      if (
        !tool ||
        typeof tool.name !== 'string' ||
        tool.name.length > 160 ||
        !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(tool.name) ||
        names.has(tool.name)
      )
        return false
      names.add(tool.name)
    }
    return true
  }

  private scheduleIdle(): void {
    this.clearIdleTimer()
    const timeoutMs = this.options.idleTimeoutMs ?? 2 * 60_000
    if (this.disposed || timeoutMs <= 0 || this.loadWaiter || this.invocations.size > 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.disposed || this.invocations.size > 0) return
      this.options.onIdle?.()
      this.dispose()
    }, timeoutMs)
  }
}
