import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  const rows = new Map<string, string>()
  const securePlugin = {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  }
  const database = {
    open: vi.fn(() => Promise.resolve(undefined)),
    close: vi.fn(() => Promise.resolve(undefined)),
    execute: vi.fn(() => Promise.resolve(undefined)),
    run: vi.fn((query: string, values: unknown[] = []) => {
      if (query.includes('INSERT OR REPLACE')) {
        rows.set(String(values[0]), String(values[1]))
      } else if (query.includes('DELETE FROM')) {
        rows.delete(String(values[0]))
      }
      return Promise.resolve({ changes: { changes: 1 } })
    }),
    query: vi.fn((query: string, values: unknown[] = []) => {
      if (query.includes('SELECT value FROM')) {
        const value = rows.get(String(values[0]))
        return Promise.resolve({ values: value === undefined ? [] : [{ value }] })
      }
      if (query.includes('SELECT key FROM')) {
        return Promise.resolve({ values: [...rows.keys()].map((key) => ({ key })) })
      }
      return Promise.resolve({ values: [...rows.entries()].map(([key, value]) => ({ key, value })) })
    }),
  }

  return { database, rows, securePlugin }
})

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => testState.securePlugin),
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class MockSQLiteConnection {
    closeConnection = vi.fn(() => Promise.resolve(undefined))

    createConnection() {
      return Promise.resolve(testState.database)
    }
  },
}))

vi.mock('@/storage', () => ({
  StorageKey: {
    Settings: 'settings',
  },
}))

vi.mock('.', () => ({
  default: { type: 'mobile' },
}))

import { isYachiyoSecureStorageEnvelope } from './native/yachiyo_secure_storage'
import { isProtectedMobileSettingsError, MobileSQLiteStorage, ProtectedMobileSettingsError } from './storages'

const SETTINGS_ENVELOPE =
  'yachiyo-secure-storage:{"version":1,"algorithm":"AES-256-GCM","iv":"AQIDBAUGBwgJCgsM","ciphertext":"AAECAwQFBgcICQoLDA0ODw=="}'

describe('Yachiyo secure mobile settings storage', () => {
  beforeEach(() => {
    testState.rows.clear()
    vi.clearAllMocks()
    testState.securePlugin.encrypt.mockResolvedValue({ envelope: SETTINGS_ENVELOPE })
    testState.securePlugin.decrypt.mockResolvedValue({ plaintext: '{"theme":"dark"}' })
  })

  it('recognizes only supported versioned secure-storage envelopes', () => {
    expect(isYachiyoSecureStorageEnvelope(SETTINGS_ENVELOPE)).toBe(true)
    expect(isYachiyoSecureStorageEnvelope('{"theme":"dark"}')).toBe(false)
    expect(
      isYachiyoSecureStorageEnvelope(
        'yachiyo-secure-storage:{"version":2,"algorithm":"AES-256-GCM","iv":"iv","ciphertext":"ciphertext"}'
      )
    ).toBe(false)
    expect(isYachiyoSecureStorageEnvelope('yachiyo-secure-storage:not-json')).toBe(false)
  })

  it('encrypts the complete settings value while leaving other mobile rows unchanged', async () => {
    const storage = new MobileSQLiteStorage()

    await storage.setStoreValue('settings', { providers: { openai: { apiKey: 'secret' } } })
    await storage.setStoreValue('configs', { uuid: 'device-id' })

    expect(testState.securePlugin.encrypt).toHaveBeenCalledWith({
      plaintext: '{"providers":{"openai":{"apiKey":"secret"}}}',
    })
    expect(testState.rows.get('settings')).toBe(SETTINGS_ENVELOPE)
    expect(testState.rows.get('configs')).toBe('{"uuid":"device-id"}')
  })

  it('migrates legacy plaintext settings after parsing them without changing their value', async () => {
    const legacySettings = '{ "theme": "light", "language": "zh" }'
    testState.rows.set('settings', legacySettings)
    const storage = new MobileSQLiteStorage()

    await expect(storage.getStoreValue('settings')).resolves.toEqual({ theme: 'light', language: 'zh' })

    expect(testState.securePlugin.encrypt).toHaveBeenCalledWith({ plaintext: legacySettings })
    expect(testState.securePlugin.decrypt).not.toHaveBeenCalled()
    expect(testState.rows.get('settings')).toBe(SETTINGS_ENVELOPE)
  })

  it('decrypts settings and migrates legacy settings through getAllStoreValues', async () => {
    const storage = new MobileSQLiteStorage()
    testState.rows.set('settings', SETTINGS_ENVELOPE)
    testState.rows.set('configs', '{"uuid":"device-id"}')

    await expect(storage.getAllStoreValues()).resolves.toEqual({
      settings: { theme: 'dark' },
      configs: { uuid: 'device-id' },
    })
    expect(testState.securePlugin.decrypt).toHaveBeenCalledWith({ envelope: SETTINGS_ENVELOPE })

    const legacySettings = '{"theme":"light"}'
    testState.rows.set('settings', legacySettings)
    await expect(storage.getAllStoreValues()).resolves.toMatchObject({ settings: { theme: 'light' } })
    expect(testState.securePlugin.encrypt).toHaveBeenCalledWith({ plaintext: legacySettings })
    expect(testState.rows.get('settings')).toBe(SETTINGS_ENVELOPE)
  })

  it('does not downgrade a malformed protected envelope into legacy plaintext migration', async () => {
    testState.rows.set('settings', 'yachiyo-secure-storage:not-json')
    const storage = new MobileSQLiteStorage()

    await expect(storage.getStoreValue('settings')).rejects.toEqual(new ProtectedMobileSettingsError())
    expect(testState.securePlugin.encrypt).not.toHaveBeenCalled()
    expect(testState.securePlugin.decrypt).not.toHaveBeenCalled()
  })

  it('does not expose malformed legacy plaintext through parse errors', async () => {
    const sensitiveInvalidValue = 'invalid-json-with-api-key-sk-private'
    testState.rows.set('settings', sensitiveInvalidValue)
    const storage = new MobileSQLiteStorage()

    const error = await storage.getStoreValue('settings').catch((cause: unknown) => cause)
    expect(error).toEqual(new ProtectedMobileSettingsError())
    expect(isProtectedMobileSettingsError(error)).toBe(true)
    expect(String(error)).not.toContain(sensitiveInvalidValue)
    expect(testState.rows.get('settings')).toBe(sensitiveInvalidValue)
    expect(testState.securePlugin.encrypt).not.toHaveBeenCalled()
  })

  it('classifies Keystore decrypt failures without retaining native error details', async () => {
    const sensitiveNativeDetail = 'native-crypto-error-containing-ciphertext'
    testState.rows.set('settings', SETTINGS_ENVELOPE)
    testState.securePlugin.decrypt.mockRejectedValueOnce(new Error(sensitiveNativeDetail))
    const storage = new MobileSQLiteStorage()

    const error = await storage.getStoreValue('settings').catch((cause: unknown) => cause)

    expect(isProtectedMobileSettingsError(error)).toBe(true)
    expect(error).toBeInstanceOf(ProtectedMobileSettingsError)
    expect(String(error)).toBe('ProtectedMobileSettingsError: Unable to read protected mobile settings.')
    expect(String(error)).not.toContain(sensitiveNativeDetail)
    expect(error).not.toHaveProperty('cause')
  })

  it('classifies failed legacy protection without retaining encryption or database details', async () => {
    const legacySettings = '{"theme":"light"}'
    testState.rows.set('settings', legacySettings)
    testState.securePlugin.encrypt.mockRejectedValueOnce(new Error('native-encryption-detail'))

    const encryptionError = await new MobileSQLiteStorage().getStoreValue('settings').catch((cause: unknown) => cause)

    expect(isProtectedMobileSettingsError(encryptionError)).toBe(true)
    expect(encryptionError).not.toHaveProperty('cause')
    expect(String(encryptionError)).not.toContain('native-encryption-detail')
    expect(testState.rows.get('settings')).toBe(legacySettings)

    testState.securePlugin.encrypt.mockResolvedValueOnce({ envelope: SETTINGS_ENVELOPE })
    testState.database.run.mockRejectedValueOnce(new Error('database-write-detail'))

    const writeError = await new MobileSQLiteStorage().getStoreValue('settings').catch((cause: unknown) => cause)

    expect(isProtectedMobileSettingsError(writeError)).toBe(true)
    expect(writeError).not.toHaveProperty('cause')
    expect(String(writeError)).not.toContain('database-write-detail')
    expect(testState.rows.get('settings')).toBe(legacySettings)
  })

  it('does not classify failures from unprotected storage rows', async () => {
    testState.rows.set('configs', 'invalid-json')
    const storage = new MobileSQLiteStorage()

    const error = await storage.getStoreValue('configs').catch((cause: unknown) => cause)

    expect(isProtectedMobileSettingsError(error)).toBe(false)
    expect(error).toBeInstanceOf(SyntaxError)
  })
})
