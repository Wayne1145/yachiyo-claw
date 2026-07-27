import type { JsonValue } from '../agent/contracts'
import type { PluginManifest } from './manifest'
import type { PluginView } from './view-schema'

/**
 * Public, dependency-free authoring surface for self-contained Yachiyo plugin bundles.
 *
 * Keep this module limited to types, literals, and identity helpers. Plugin projects may copy the
 * generated declaration file from `scripts/create-plugin.mjs`; they must not depend on the app's
 * renderer bundle or import runtime code from this repository.
 */

export type { JsonValue } from '../agent/contracts'
export type { PluginCapability, PluginManifest } from './manifest'
export type { PluginView, PluginIconName, ViewAction, ViewNode } from './view-schema'

export const YACHIYO_PLUGIN_PROTOCOL_VERSION = 1 as const

export const PLUGIN_HOST_METHODS = [
  'storage.get',
  'storage.set',
  'storage.remove',
  'storage.keys',
  'network.fetch',
  'sandbox.exec',
  'sandbox.readFile',
  'sandbox.writeFile',
  'device.observe',
  'device.find',
  'device.click',
  'device.setText',
  'device.scroll',
  'device.launch',
  'device.keyevent',
] as const

export type PluginHostMethod = (typeof PLUGIN_HOST_METHODS)[number]

export interface PluginNodeSelector {
  packageName?: string
  resourceId?: string
  text?: string
  contentDescription?: string
  role?: string
  ancestorSignature?: string
}

export interface PluginHostCallMap {
  'storage.get': { args: { key: string }; result: string | null }
  'storage.set': { args: { key: string; value: string }; result: { ok: true } }
  'storage.remove': { args: { key: string }; result: { ok: true } }
  'storage.keys': { args: Record<string, never>; result: { keys: string[] } }
  'network.fetch': {
    args: { url: string; method?: string; headers?: Record<string, string>; body?: string }
    result: { status: number; contentType: string; body: string; truncated: boolean; finalUrl: string }
  }
  'sandbox.exec': {
    args: { command: string; timeoutMs?: number }
    result: { stdout: string; stderr: string; exitCode: number }
  }
  'sandbox.readFile': { args: { path: string }; result: { content: string } }
  'sandbox.writeFile': { args: { path: string; content: string }; result: { ok: true } }
  'device.observe': { args: Record<string, never>; result: JsonValue }
  'device.find': { args: PluginNodeSelector; result: JsonValue }
  'device.click': { args: PluginNodeSelector; result: JsonValue }
  'device.setText': { args: PluginNodeSelector & { value: string }; result: JsonValue }
  'device.scroll': {
    args: PluginNodeSelector & { direction: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward' }
    result: JsonValue
  }
  'device.launch': { args: { packageName: string; activityName?: string }; result: JsonValue }
  'device.keyevent': { args: { key: 'BACK' | 'HOME' | 'RECENTS' }; result: JsonValue }
}

export interface YachiyoPluginApi {
  registerTool(name: string, handler: (args: JsonValue) => JsonValue | Promise<JsonValue>): void
  log(level: 'log' | 'warn' | 'error', message: string): void
  host: {
    call<Method extends PluginHostMethod>(
      method: Method,
      args: PluginHostCallMap[Method]['args']
    ): Promise<PluginHostCallMap[Method]['result']>
  }
}

export interface PluginContext {
  api: YachiyoPluginApi
  manifest: PluginManifest
}

export type YachiyoPluginSetup = (api: YachiyoPluginApi) => void | Promise<void>

/** Identity helper for plugin authors; bundlers erase it and produce the required single entry file. */
export function defineYachiyoPlugin(setup: YachiyoPluginSetup): YachiyoPluginSetup {
  return setup
}

/** Gives declarative views SDK typing while leaving runtime validation to the host. */
export function defineYachiyoPluginView(view: PluginView): PluginView {
  return view
}
