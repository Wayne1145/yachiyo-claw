import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  securePlugin: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => testState.securePlugin),
}))

vi.mock('@/variables', () => ({
  CHATBOX_BUILD_PLATFORM: 'android',
  CHATBOX_BUILD_TARGET: 'mobile_app',
}))

const AUTH_INFO_STORAGE_KEY = 'chatbox-ai-auth-info'
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

function createLocalStorage() {
  const rows = new Map<string, string>()
  const storage = {
    get length() {
      return rows.size
    },
    clear: vi.fn(() => rows.clear()),
    getItem: vi.fn((name: string) => rows.get(name) ?? null),
    key: vi.fn((index: number) => [...rows.keys()][index] ?? null),
    removeItem: vi.fn((name: string) => rows.delete(name)),
    setItem: vi.fn((name: string, value: string) => rows.set(name, value)),
  } satisfies Storage
  return { rows, storage }
}

function loadMobileAuthInfoStore(storage: Storage) {
  vi.resetModules()
  vi.stubGlobal('window', { localStorage: storage })
  return import('./authInfoStore')
}

describe('authInfoStore mobile secure hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.securePlugin.encrypt.mockResolvedValue({ envelope: AUTH_ENVELOPE })
    testState.securePlugin.decrypt.mockResolvedValue({ plaintext: SERIALIZED_AUTH_INFO })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('awaits hydration once and migrates legacy plaintext before exposing tokens', async () => {
    const { rows, storage } = createLocalStorage()
    rows.set(AUTH_INFO_STORAGE_KEY, SERIALIZED_AUTH_INFO)
    const { authInfoStore, initAuthInfoStore } = await loadMobileAuthInfoStore(storage)

    expect(authInfoStore.persist.hasHydrated()).toBe(false)
    expect(authInfoStore.getState().getTokens()).toBeNull()

    const firstInitialization = initAuthInfoStore()
    const secondInitialization = initAuthInfoStore()
    expect(secondInitialization).toBe(firstInitialization)
    await expect(firstInitialization).resolves.toMatchObject({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    })

    expect(authInfoStore.persist.hasHydrated()).toBe(true)
    expect(authInfoStore.getState().getTokens()).toEqual({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    })
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).toBe(AUTH_ENVELOPE)
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).not.toContain(ACCESS_TOKEN)
  })

  it('encrypts normal Zustand writes instead of persisting plaintext tokens', async () => {
    const { rows, storage } = createLocalStorage()
    const { authInfoStore, initAuthInfoStore } = await loadMobileAuthInfoStore(storage)
    await initAuthInfoStore()

    authInfoStore.getState().setTokens({ accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN })

    await vi.waitFor(() => expect(rows.get(AUTH_INFO_STORAGE_KEY)).toBe(AUTH_ENVELOPE))
    expect(testState.securePlugin.encrypt).toHaveBeenLastCalledWith({ plaintext: SERIALIZED_AUTH_INFO })
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).not.toContain(ACCESS_TOKEN)
    expect(rows.get(AUTH_INFO_STORAGE_KEY)).not.toContain(REFRESH_TOKEN)
  })

  it('clears unreadable ciphertext and completes initialization as signed out', async () => {
    const { rows, storage } = createLocalStorage()
    rows.set(AUTH_INFO_STORAGE_KEY, AUTH_ENVELOPE)
    testState.securePlugin.decrypt.mockRejectedValue(new Error(`cannot decrypt ${ACCESS_TOKEN}`))
    const { authInfoStore, initAuthInfoStore } = await loadMobileAuthInfoStore(storage)

    await expect(initAuthInfoStore()).resolves.toMatchObject({
      accessToken: null,
      refreshToken: null,
    })

    expect(authInfoStore.persist.hasHydrated()).toBe(true)
    expect(authInfoStore.getState().getTokens()).toBeNull()
    expect(rows.has(AUTH_INFO_STORAGE_KEY)).toBe(false)
  })
})
