import type { JsonValue } from '@shared/agent/contracts'
import { YACHIYO_PLUGIN_PROTOCOL_VERSION } from '@shared/plugins/sdk'

/**
 * Host ⇄ isolate-worker RPC protocol (platform-21).
 *
 * Only pure serializable data crosses the boundary — never host objects, class instances, or prototypes
 * (which would drag their whole prototype chain across). The transport is abstracted so the same
 * protocol runs over a real Blob Worker in the app and over an in-process linked pair in tests.
 */

export interface PluginToolMeta {
  name: string
  description: string
}

export type HostToWorkerMessage =
  | { type: 'load'; protocolVersion: number; pluginId: string; entry: string }
  | { type: 'invoke'; callId: string; name: string; args: JsonValue }
  | { type: 'host-result'; callId: string; ok: true; value: JsonValue }
  | { type: 'host-result'; callId: string; ok: false; error: string }

export type WorkerToHostMessage =
  | { type: 'ready'; protocolVersion: number; tools: PluginToolMeta[] }
  | { type: 'load-error'; error: string }
  | { type: 'result'; callId: string; value: JsonValue }
  | { type: 'error'; callId: string; error: string }
  | { type: 'host-call'; callId: string; invocationId: string; method: string; args: JsonValue }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; message: string }

export interface Transport {
  post(message: unknown): void
  subscribe(handler: (message: unknown) => void): () => void
  terminate(): void
}

/** Shared SDK/RPC version used by both sides of the isolate handshake. */
export const PLUGIN_RPC_PROTOCOL_VERSION = YACHIYO_PLUGIN_PROTOCOL_VERSION

/** Clamps any thrown value to a short, path-free string so plugin errors never leak host internals. */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^[\w .:_-]{1,120}$/.test(message) ? message : 'plugin_error'
}
