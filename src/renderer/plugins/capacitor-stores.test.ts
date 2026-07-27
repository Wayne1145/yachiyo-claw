import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginGrant } from '@shared/plugins/grants'

const mocks = vi.hoisted(() => ({ stores: [] as Array<Map<string, unknown>> }))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Data: 'DATA' }, Filesystem: {} }))
vi.mock('@/platform/native/yachiyo_secure_storage', () => ({
  encryptMobileProtectedValue: async (plaintext: string, context?: string) =>
    `secure:v2:${encodeURIComponent(context ?? '')}:${plaintext}`,
  decryptMobileProtectedValue: async (envelope: string, context?: string) => {
    const prefix = `secure:v2:${encodeURIComponent(context ?? '')}:`
    if (!envelope.startsWith(prefix)) throw new Error('context_mismatch')
    return envelope.slice(prefix.length)
  },
  isYachiyoSecureStorageEnvelope: (value: unknown) => typeof value === 'string' && value.startsWith('secure:'),
  yachiyoSecureStorageEnvelopeVersion: (value: unknown) =>
    typeof value === 'string' && value.startsWith('secure:v1:') ? 1 : 2,
}))
vi.mock('localforage', () => ({
  default: {
    createInstance: () => {
      const values = new Map<string, unknown>()
      mocks.stores.push(values)
      return {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
          values.set(key, value)
          return value
        },
        removeItem: async (key: string) => values.delete(key),
        keys: async () => [...values.keys()],
        iterate: async () => undefined,
      }
    },
  },
}))

import { pluginDataStore, pluginGrantStore } from './capacitor-stores'

const grant: PluginGrant = {
  schemaVersion: 1,
  pluginId: 'demo',
  capability: 'storage',
  state: 'granted',
  boundEntrySha256: 'a'.repeat(64),
  decidedAt: 1,
  expiresAt: null,
}

describe('Android plugin grant persistence', () => {
  beforeEach(() => mocks.stores.forEach((store) => store.clear()))

  it('persists only a Keystore envelope and reads the validated grant back', async () => {
    await pluginGrantStore.put(grant)
    const raw = mocks.stores[1].get('demo:storage')
    expect(raw).toBe(`secure:v2:plugin-grant%2Fv2%2Fdemo%2Fstorage:${JSON.stringify(grant)}`)
    await expect(pluginGrantStore.get('demo', 'storage')).resolves.toEqual(grant)
  })

  it('migrates a valid legacy record and fails closed for corrupt data', async () => {
    mocks.stores[1].set('demo:storage', grant)
    await expect(pluginGrantStore.get('demo', 'storage')).resolves.toEqual(grant)
    expect(mocks.stores[1].get('demo:storage')).toBe(
      `secure:v2:plugin-grant%2Fv2%2Fdemo%2Fstorage:${JSON.stringify(grant)}`
    )
    mocks.stores[1].set('demo:storage', 'plaintext-corrupt')
    await expect(pluginGrantStore.get('demo', 'storage')).resolves.toBeNull()
    expect(mocks.stores[1].has('demo:storage')).toBe(false)
  })

  it('rejects an encrypted grant moved to another plugin or capability key', async () => {
    await pluginGrantStore.put(grant)
    const envelope = mocks.stores[1].get('demo:storage')
    mocks.stores[1].set('other:storage', envelope)
    await expect(pluginGrantStore.get('other', 'storage')).resolves.toBeNull()
    expect(mocks.stores[1].has('other:storage')).toBe(false)
  })
})

describe('Android plugin data persistence', () => {
  beforeEach(() => mocks.stores.forEach((store) => store.clear()))

  it('encrypts plugin values and accounts quota bytes from plaintext', async () => {
    await pluginDataStore.set('plugin:demo:token', 'secret-token')
    expect(mocks.stores[2].get('plugin:demo:token')).toEqual({
      schemaVersion: 2,
      envelope: 'secure:v2:plugin-data%2Fv2%2Fplugin%253Ademo%253Atoken:secret-token',
    })
    await expect(pluginDataStore.get('plugin:demo:token')).resolves.toBe('secret-token')
    await expect(pluginDataStore.usedBytes('plugin:demo:')).resolves.toBe(
      new TextEncoder().encode('secret-token').byteLength
    )
  })

  it('migrates legacy plaintext data into a protected envelope', async () => {
    mocks.stores[2].set('plugin:demo:value', 'legacy')
    await expect(pluginDataStore.get('plugin:demo:value')).resolves.toBe('legacy')
    expect(mocks.stores[2].get('plugin:demo:value')).toEqual({
      schemaVersion: 2,
      envelope: 'secure:v2:plugin-data%2Fv2%2Fplugin%253Ademo%253Avalue:legacy',
    })
  })

  it('rejects a protected value copied to another plugin storage key', async () => {
    await pluginDataStore.set('plugin:demo:token', 'secret-token')
    mocks.stores[2].set('plugin:other:token', mocks.stores[2].get('plugin:demo:token'))

    await expect(pluginDataStore.get('plugin:other:token')).resolves.toBeNull()
    expect(mocks.stores[2].has('plugin:other:token')).toBe(false)
  })
})
