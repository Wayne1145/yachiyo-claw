import { describe, expect, it } from 'vitest'
import {
  checkCodeWithinQuota,
  checkWriteWithinQuota,
  isValidStorageKey,
  PLUGIN_STORAGE_LIMITS,
  pluginStorageKey,
} from './storage'

describe('isValidStorageKey', () => {
  it('rejects prototype-chain pollution keys', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) expect(isValidStorageKey(key)).toBe(false)
  })
  it('rejects empty, over-long, leading/trailing separators, and bad chars', () => {
    expect(isValidStorageKey('')).toBe(false)
    expect(isValidStorageKey('a'.repeat(129))).toBe(false)
    expect(isValidStorageKey('_leading')).toBe(false)
    expect(isValidStorageKey('trailing.')).toBe(false)
    expect(isValidStorageKey('has space')).toBe(false)
    expect(isValidStorageKey('has/slash')).toBe(false)
    expect(isValidStorageKey(42 as unknown as string)).toBe(false)
  })
  it('accepts normal namespaced keys', () => {
    for (const key of ['settings', 'user.profile', 'cache_v2', 'a1-b2.c3']) expect(isValidStorageKey(key)).toBe(true)
  })
})

describe('pluginStorageKey', () => {
  it('namespaces valid input and rejects invalid ids or keys', () => {
    expect(pluginStorageKey('weather-plugin', 'settings')).toBe('plugin:weather-plugin:settings')
    expect(() => pluginStorageKey('Bad_Id', 'settings')).toThrow()
    expect(() => pluginStorageKey('weather-plugin', '__proto__')).toThrow()
  })
})

describe('checkWriteWithinQuota', () => {
  const base = { currentKeyBytes: 0, pluginBytes: 0, totalBytes: 0 }
  it('allows a write within all limits', () => {
    expect(checkWriteWithinQuota(1024, base).ok).toBe(true)
  })
  it('rejects an over-size single key', () => {
    expect(checkWriteWithinQuota(PLUGIN_STORAGE_LIMITS.maxKeyBytes + 1, base)).toEqual({
      ok: false,
      reason: 'key_too_large',
    })
  })
  it('rejects when the plugin quota would be exceeded, accounting for the replaced key', () => {
    const near = PLUGIN_STORAGE_LIMITS.maxPluginBytes - 10
    expect(checkWriteWithinQuota(1024, { currentKeyBytes: 0, pluginBytes: near, totalBytes: near })).toEqual({
      ok: false,
      reason: 'plugin_quota_exceeded',
    })
    // Overwriting an existing key frees its old bytes, so the same write now fits.
    expect(checkWriteWithinQuota(1024, { currentKeyBytes: 2048, pluginBytes: near, totalBytes: near }).ok).toBe(true)
  })
  it('rejects when the global total would be exceeded', () => {
    const near = PLUGIN_STORAGE_LIMITS.maxTotalBytes - 10
    expect(checkWriteWithinQuota(1024, { currentKeyBytes: 0, pluginBytes: 0, totalBytes: near })).toEqual({
      ok: false,
      reason: 'total_quota_exceeded',
    })
  })
})

describe('checkCodeWithinQuota', () => {
  it('bounds unpacked plugin code', () => {
    expect(checkCodeWithinQuota(1_000_000).ok).toBe(true)
    expect(checkCodeWithinQuota(PLUGIN_STORAGE_LIMITS.maxPluginCodeBytes + 1)).toEqual({
      ok: false,
      reason: 'plugin_code_too_large',
    })
  })
})
