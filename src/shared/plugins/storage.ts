/**
 * Plugin storage isolation + quota policy (platform-28 pure core).
 *
 * The Capacitor data adapter and Keystore-backed grant adapter use this platform-agnostic policy:
 * namespaced keys that reject prototype-chain pollution, and quota accounting that rejects
 * over-limit writes with a clear reason instead of silently truncating (which would corrupt data).
 */

export const PLUGIN_STORAGE_LIMITS = {
  maxKeyBytes: 64 * 1024, // per key value
  maxPluginBytes: 2 * 1024 * 1024, // per plugin data
  maxPluginCodeBytes: 10 * 1024 * 1024, // per plugin unpacked code
  maxTotalBytes: 100 * 1024 * 1024, // all plugins combined
} as const

// Keys that would pollute a plain object if used as property names.
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function isValidStorageKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 128) return false
  if (FORBIDDEN_KEYS.has(key)) return false
  // Alphanumeric start/end, with dot/dash/underscore separators inside. A leading '_' (e.g. __proto__)
  // is already rejected here, but FORBIDDEN_KEYS is kept as belt-and-suspenders.
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(key)
}

/** Namespaced storage key. Both the plugin id and the key are validated to keep namespaces isolated. */
export function pluginStorageKey(pluginId: string, key: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pluginId)) throw new Error(`Invalid plugin id "${pluginId}".`)
  if (!isValidStorageKey(key)) throw new Error(`Invalid storage key "${key}".`)
  return `plugin:${pluginId}:${key}`
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export interface QuotaState {
  /** Bytes the key currently occupies (0 for a new key); subtracted from the deltas below. */
  currentKeyBytes: number
  /** Bytes this plugin currently uses across all its keys. */
  pluginBytes: number
  /** Bytes all plugins currently use. */
  totalBytes: number
}

export type QuotaDecision = { ok: true } | { ok: false; reason: string }

/** Decides whether writing `valueBytes` to a key is within per-key, per-plugin, and total quotas. */
export function checkWriteWithinQuota(valueBytes: number, state: QuotaState): QuotaDecision {
  if (valueBytes < 0) return { ok: false, reason: 'invalid_size' }
  if (valueBytes > PLUGIN_STORAGE_LIMITS.maxKeyBytes) return { ok: false, reason: 'key_too_large' }
  const nextPluginBytes = state.pluginBytes - state.currentKeyBytes + valueBytes
  if (nextPluginBytes > PLUGIN_STORAGE_LIMITS.maxPluginBytes) return { ok: false, reason: 'plugin_quota_exceeded' }
  const nextTotalBytes = state.totalBytes - state.currentKeyBytes + valueBytes
  if (nextTotalBytes > PLUGIN_STORAGE_LIMITS.maxTotalBytes) return { ok: false, reason: 'total_quota_exceeded' }
  return { ok: true }
}

/** Decides whether an unpacked plugin's code size is within the per-plugin code limit. */
export function checkCodeWithinQuota(codeBytes: number): QuotaDecision {
  if (codeBytes < 0) return { ok: false, reason: 'invalid_size' }
  if (codeBytes > PLUGIN_STORAGE_LIMITS.maxPluginCodeBytes) return { ok: false, reason: 'plugin_code_too_large' }
  return { ok: true }
}
