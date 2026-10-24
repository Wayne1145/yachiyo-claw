import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { v4 as uuidv4 } from 'uuid'
import { asSchema, type ToolSet } from 'ai'
import { yachiyoRealtimeNative, type RealtimeNative } from '@/platform/native/yachiyo_realtime'
import { normalizeUsage, recordUsage } from './usage-statistics'
import {
  realtimeEndpoint,
  realtimeImageEvent,
  realtimeSessionUpdate,
  realtimeTextEvent,
  realtimeHistoryEvent,
  realtimeVadUpdate,
  type RealtimeHistoryItem,
} from './realtime-protocol'
import type { RealtimeSettings } from './realtime-settings'

export interface RealtimeCallbacks {
  onState(state: 'connecting' | 'connected' | 'disconnected'): void
  onSpeaking(speaking: boolean): void
  onInputLevel?(level: number): void
  onText(text: string): void
  onTranscript(id: string, role: 'user' | 'assistant', text: string, timestamp?: number): Promise<void>
  onTool?(id: string, name: string, args: unknown, result: unknown, failed: boolean): Promise<void>
  onError(message: string): void
}

/** Genuine audio-in/audio-out session; the normal chat/ASR/TTS pipeline is not invoked. */
export class RealtimeCall {
  readonly id = `rt-${uuidv4()}`
  readonly abort = new AbortController()
  private listeners: PluginListenerHandle[] = []
  private closed = false
  private ready = false
  private timer?: ReturnType<typeof setTimeout>
  private transcripts = new Map<string, string>()
  private itemTimes = new Map<string, number>()
  private lastItemTime = 0
  private pendingTools = new Map<string, Promise<void>>()
  private executedTools = new Set<string>()
  private toolCalls = 0
  private responding = false
  private upstreamError?: string
  private toolQueue = Promise.resolve()

  constructor(
    private settings: RealtimeSettings,
    private callbacks: RealtimeCallbacks,
    private native: RealtimeNative = yachiyoRealtimeNative
  ) {}

  async connect(
    apiKey: string,
    instructions: string,
    definitions: unknown[],
    privateTools: ToolSet,
    history: RealtimeHistoryItem[],
    muted = false,
    microphoneMuted = false
  ) {
    if (this.closed) throw new Error('realtime_call_closed')
    if (!Capacitor.isNativePlatform() && this.native === yachiyoRealtimeNative)
      throw new Error('realtime_android_required')
    const endpoint = realtimeEndpoint(this.settings)
    this.callbacks.onState('connecting')
    try {
      this.listeners.push(
        await this.native.addListener('realtimeLevel', (event) => {
          if (!this.closed && event.connectionId === this.id)
            this.callbacks.onInputLevel?.(Math.max(0, Math.min(1, event.level)))
        })
      )
      this.listeners.push(
        await this.native.addListener('realtimeState', (event) => {
          if (this.closed || event.connectionId !== this.id) return
          if (event.state === 'speaking' || event.state === 'silent')
            this.callbacks.onSpeaking(event.state === 'speaking')
          else {
            if (event.error) this.callbacks.onError(this.upstreamError || event.error)
            void this.close()
          }
        })
      )
      this.listeners.push(
        await this.native.addListener('realtimeEvent', (event) => {
          if (this.closed || event.connectionId !== this.id) return
          void this.handleEvent(event.event, privateTools, history).catch((error) => {
            this.callbacks.onError(error instanceof Error ? error.message : 'realtime_event_failed')
            void this.close()
          })
        })
      )
      this.timer = setTimeout(() => {
        if (!this.ready) {
          this.callbacks.onError('realtime_session_timeout')
          void this.close()
        }
      }, 20000)
      await this.native.connect({
        connectionId: this.id,
        endpoint,
        apiKey,
        muted,
        microphoneMuted,
        inputRate: this.settings.protocol === 'dashscope' ? 16000 : 24000,
        outputRate: 24000,
        sessionUpdate: realtimeSessionUpdate(this.settings, instructions, definitions),
      })
      await this.setMuted(muted)
    } catch (error) {
      await this.close()
      throw error
    }
  }

  private async handleEvent(event: Record<string, unknown>, tools: ToolSet, history: RealtimeHistoryItem[]) {
    const type = String(event.type)
    const item = event.item as { id?: string } | undefined
    const itemId = String(event.item_id || item?.id || '')
    if (itemId && !this.itemTimes.has(itemId)) {
      this.lastItemTime = Math.max(Date.now(), this.lastItemTime + 1)
      this.itemTimes.set(itemId, this.lastItemTime)
    }
    if (type === 'response.created') this.responding = true
    if (type === 'session.updated' && !this.ready) {
      this.ready = true
      clearTimeout(this.timer)
      for (const item of history) await this.send(realtimeHistoryEvent(this.settings.protocol, item))
      await this.native.startMicrophone({ connectionId: this.id })
      this.callbacks.onState('connected')
    } else if (type === 'error') {
      const error = event.error as { message?: string; code?: string } | undefined
      this.upstreamError = error?.message || error?.code || 'realtime_upstream_error'
      this.callbacks.onError(this.upstreamError)
      // A rejected session configuration must not leave a microphone-only zombie call.
      if (!this.ready) await this.close()
    } else if (type === 'conversation.item.input_audio_transcription.completed') {
      await this.callbacks.onTranscript(
        `${this.id}:${event.item_id}`,
        'user',
        String(event.transcript || ''),
        this.itemTimes.get(itemId)
      )
    } else if (/^response\.(?:output_)?(?:audio_transcript|text)\.delta$/.test(type)) {
      const key = String(event.item_id || event.response_id || 'latest')
      const text = (this.transcripts.get(key) || '') + String(event.delta || '')
      this.transcripts.set(key, text)
      this.callbacks.onText(text)
    } else if (/^response\.(?:output_)?(?:audio_transcript|text)\.done$/.test(type)) {
      const key = String(event.item_id || event.response_id || 'latest')
      const text = String(event.transcript || event.text || this.transcripts.get(key) || '')
      this.transcripts.set(key, text)
      this.callbacks.onText(text)
      await this.callbacks.onTranscript(`${this.id}:${key}`, 'assistant', text, this.itemTimes.get(key))
    } else if (type === 'response.function_call_arguments.done') {
      this.queueTool(event, tools)
    } else if (type === 'response.done') {
      this.responding = false
      const response = event.response as
        | {
            id?: string
            usage?: unknown
            output?: Record<string, unknown>[]
            status?: string
            status_details?: { error?: { message?: string } }
          }
        | undefined
      if (response?.status === 'failed') {
        this.upstreamError = response.status_details?.error?.message || 'realtime_response_failed'
        this.callbacks.onError(this.upstreamError)
      }
      const calls = response?.output?.filter((item) => item.type === 'function_call') || []
      for (const call of calls) this.queueTool(call, tools)
      recordUsage({
        id: `${this.id}:${response?.id || event.event_id}`,
        at: Date.now(),
        provider: `realtime:${this.settings.protocol}`,
        model: this.settings.model,
        mode: 'realtime',
        ...normalizeUsage(response?.usage),
        toolCalls: this.toolCalls,
      })
      this.toolCalls = 0
      if (calls.length || this.pendingTools.size) {
        const pending = [...this.pendingTools.values()]
        await Promise.all(pending)
        this.pendingTools.clear()
        if (!this.closed) await this.send({ type: 'response.create' })
      }
    }
  }

  private queueTool(event: Record<string, unknown>, tools: ToolSet) {
    const callId = String(event.call_id || '')
    if (!callId || this.executedTools.has(callId)) return
    this.executedTools.add(callId)
    this.toolCalls++
    const operation = this.toolQueue.then(async () => {
      if (this.closed) return
      let output: unknown
      let input: unknown
      let failed = false
      try {
        const definition = tools[String(event.name)]
        if (!definition?.execute) throw new Error('tool_not_available')
        const args: unknown = JSON.parse(String(event.arguments || '{}'))
        input = args
        const validator = asSchema(definition.inputSchema).validate
        if (!validator) throw new Error('tool_schema_validation_unavailable')
        const validated = await validator(args)
        if (!validated.success) throw new Error('tool_arguments_invalid')
        // These executors already contain Tool Broker permission and audit checks.
        output = await definition.execute(validated.value, {
          toolCallId: callId,
          messages: [],
          abortSignal: this.abort.signal,
        })
        if (String(event.name) === 'camera_capture' && output && typeof output === 'object' && 'data' in output) {
          await this.send(realtimeImageEvent(this.settings.protocol, String(output.data)))
          output = { captured: true }
        }
      } catch (error) {
        failed = true
        output = { error: error instanceof Error ? error.message : 'tool_execution_failed' }
      }
      const serialized = JSON.stringify(output ?? null)
      const boundedOutput =
        serialized.length > 100000
          ? JSON.stringify({ truncated: true, result: serialized.slice(0, 99000) })
          : serialized
      await this.callbacks
        .onTool?.(`${this.id}:tool:${callId}`, String(event.name), input, JSON.parse(boundedOutput), failed)
        .catch(() => this.callbacks.onError('realtime_history_save_failed'))
      if (!this.closed)
        await this.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: boundedOutput,
          },
        })
    })
    this.toolQueue = operation.catch(() => undefined)
    this.pendingTools.set(callId, operation)
  }

  private send(event: unknown) {
    if (this.closed) return Promise.resolve()
    return this.native.sendEvent({ connectionId: this.id, event })
  }
  async sendText(text: string) {
    if (!this.ready) throw new Error('realtime_not_ready')
    if (this.pendingTools.size) throw new Error('realtime_tools_running')
    if (this.responding) {
      await this.send({ type: 'response.cancel' })
      await this.native.interrupt({ connectionId: this.id })
    }
    const itemId = `item_${uuidv4().replace(/-/g, '').slice(0, 24)}`
    await this.send(realtimeTextEvent(text, itemId))
    await this.callbacks
      .onTranscript(`${this.id}:${itemId}`, 'user', text, Date.now())
      .catch(() => this.callbacks.onError('realtime_history_save_failed'))
    await this.send({ type: 'response.create' })
  }
  async sendImage(data: string) {
    if (this.ready && this.settings.video) await this.send(realtimeImageEvent(this.settings.protocol, data))
  }
  setMuted(muted: boolean) {
    return this.native.setMuted({ connectionId: this.id, muted })
  }
  setMicrophoneMuted(muted: boolean) {
    return this.native.setMicrophoneMuted({ connectionId: this.id, muted })
  }
  setVadThreshold(value: number) {
    this.settings = { ...this.settings, vadThreshold: value }
    return this.ready ? this.send(realtimeVadUpdate(this.settings.protocol, value)) : Promise.resolve()
  }
  setVideoEnabled(enabled: boolean) {
    this.settings = { ...this.settings, video: enabled }
  }
  async close() {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    clearTimeout(this.timer)
    await this.native.disconnect({ connectionId: this.id }).catch(() => undefined)
    await Promise.all(
      [...this.transcripts].map(([id, text]) =>
        this.callbacks
          .onTranscript(`${this.id}:${id}`, 'assistant', text, this.itemTimes.get(id))
          .catch(() => undefined)
      )
    )
    await Promise.all(this.listeners.map((listener) => listener.remove().catch(() => undefined)))
    this.listeners = []
    this.callbacks.onSpeaking(false)
    this.callbacks.onState('disconnected')
  }
}
