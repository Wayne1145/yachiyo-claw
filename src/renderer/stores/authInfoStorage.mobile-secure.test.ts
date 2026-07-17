import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  securePlugin: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => testState.securePlugin),
}))

import { AUTH_INFO_STORAGE_KEY, createMobileAuthInfoStateStorage } from './authInfoStorage'

const AUTH_ENVELOPE =
  'yachiyo-secure-storage:{"version":1,"algorithm":"AES-256-GCM","iv":"AQIDBAUGBwgJCgsM","ciphertext":"AAECAwQFBgcICQoLDA0ODw=="}'
const ACCESS_TOKEN = 'access-token-sensitive-value'
const REFRESH_TOKEN = 'refresh-token-sensitive-value'
const SERIALIZED_AUTH_INFO = JSON.stringify({
  state: {
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
  },
  version: 0,
})

function createMemoryStorage() {
  const rows = new Map<string, string>()
  return {
    rows,
    storage: {
      getItem: vi.fn((name: string) => rows.get(name) ?? null),
      setItem: vi.fn((name: string, value: string) => {
        rows.set(name, value)
      }),
      removeItem: vi.fn((name: string) => {
        rows.delete(name)
      }),
    },
  }
}

describe('mobile auth info secure persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.securePlugin.encrypt.mockResolvedValue({ envelope: AUTH_ENVELOPE })
    testState.securePlugin.decrypt.mockResolvedValue({ plaintext: SERIALIZED_AUTH_INFO })
  })

  it('persists ciphertext without leaving either token in WebView storage', async () => {
    const { rows, storage } = createMemoryStorage()
    const secureStorage = createMobileAuthInfoStateStorage(storage)

    await secureStorage.setItem(AUTH_INFO_STORAGE_KEY, SERIALIZED_AUTH_INFO)

    const storedValue = rows.get(AUTH_INFO_STORAGE_KEY)
    expect(testState.securePlugin.encrypt).toHaveBeenCalledWith({ plaintext: SERIALIZED_AUTH_INFO })
    expect(storedValue).toBe(AUTH_ENVELOPE)
    expect(storedValue).not.toContain(ACCESS_TOKEN)
    expect(storedValue).not.toContain(REFRESH_TOKEN)
  })

  it('migrates valid legacy Zustand plaintext only after encryption succeeds', async () => {
    const { rows, storage } = createMemoryStorage()
    rows.set(AUTH_INFO_STORAGE_KEY, SERIALIZED_AUTH_INFO)
    const secureStorage = createMobileAuthInfoStateStorage(storage)

    await expect(secureStorage.getItem(AUTH_INFO_STORAGE_KEY)).resolves.toBe(SERIALIZED_AUTH_INFO)

    expect(testState.securePlugin.decrypt).not.toHaveBeenCalled()
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).toBe(AUTH_ENVELOPE)
  })

  it('leaves legacy plaintext untouched when Keystore encryption fails', async () => {
    const { rows, storage } = createMemoryStorage()
    rows.set(AUTH_INFO_STORAGE_KEY, SERIALIZED_AUTH_INFO)
    testState.securePlugin.encrypt.mockRejectedValue(new Error(`failed for ${ACCESS_TOKEN}`))
    const secureStorage = createMobileAuthInfoStateStorage(storage)

    const error = await Promise.resolve(secureStorage.getItem(AUTH_INFO_STORAGE_KEY)).catch((cause: unknown) => cause)

    expect(error).toEqual(new Error('Unable to protect mobile authentication data.'))
    expect(String(error)).not.toContain(ACCESS_TOKEN)
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).toBe(SERIALIZED_AUTH_INFO)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('decrypts and validates an existing protected value', async () => {
    const { rows, storage } = createMemoryStorage()
    rows.set(AUTH_INFO_STORAGE_KEY, AUTH_ENVELOPE)
    const secureStorage = createMobileAuthInfoStateStorage(storage)

    await expect(secureStorage.getItem(AUTH_INFO_STORAGE_KEY)).resolves.toBe(SERIALIZED_AUTH_INFO)

    expect(testState.securePlugin.decrypt).toHaveBeenCalledWith({ envelope: AUTH_ENVELOPE })
    expect(testState.securePlugin.encrypt).not.toHaveBeenCalled()
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).toBe(AUTH_ENVELOPE)
  })

  it('rejects malformed envelopes and decrypted structures without exposing token data', async () => {
    const malformedEnvelope = `yachiyo-secure-storage:not-json-${ACCESS_TOKEN}`
    const firstStorage = createMemoryStorage()
    firstStorage.rows.set(AUTH_INFO_STORAGE_KEY, malformedEnvelope)

    const malformedError = await Promise.resolve(
      createMobileAuthInfoStateStorage(firstStorage.storage).getItem(AUTH_INFO_STORAGE_KEY)
    ).catch((cause: unknown) => cause)
    expect(malformedError).toEqual(new Error('Protected mobile authentication data is invalid.'))
    expect(String(malformedError)).not.toContain(ACCESS_TOKEN)
    expect(testState.securePlugin.decrypt).not.toHaveBeenCalled()

    const secondStorage = createMemoryStorage()
    secondStorage.rows.set(AUTH_INFO_STORAGE_KEY, AUTH_ENVELOPE)
    testState.securePlugin.decrypt.mockResolvedValue({
      plaintext: JSON.stringify({ state: { accessToken: ACCESS_TOKEN } }),
    })

    const decryptedError = await Promise.resolve(
      createMobileAuthInfoStateStorage(secondStorage.storage).getItem(AUTH_INFO_STORAGE_KEY)
    ).catch((cause: unknown) => cause)
    expect(decryptedError).toEqual(new Error('Protected mobile authentication data is invalid.'))
    expect(String(decryptedError)).not.toContain(ACCESS_TOKEN)
    expect(secondStorage.rows.get(AUTH_INFO_STORAGE_KEY)).toBe(AUTH_ENVELOPE)
  })
})
