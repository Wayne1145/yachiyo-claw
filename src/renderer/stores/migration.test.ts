import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Storage Migration History:
 *
 * Storage Migration History (Android):
 *
 * v1.9.8 - v1.9.10 (config version 0-5)   localStorage
 * v1.9.11 (config version 6-7)            SQLite
 * v1.16.1 (config version 11-12)          IndexedDB
 * v1.17.0 (config version 12-13)          SQLite [CURRENT]
 *
 * Migration Logic:
 *   - Detect old storage locations (localStorage/IndexedDB/SQLite)
 *   - Copy data to new storage only if the storage type changed
 *   - Clear old storage after a successful migration
 *   - Handle multiple old storages (pick the newest by configVersion)
 *   - Skip migration when the storage type has not changed
 */

// Storage data type
type StorageData = { [key: string]: string }

// 只导入需要的类型
const StorageKey = {
  ConfigVersion: 'configVersion',
  ChatSessions: 'chat-sessions',
  ChatSessionsList: 'chat-sessions-list',
  Settings: 'settings',
  Configs: 'configs',
} as const

// Bottom-layer storage data containers
// These represent the actual data stored in different storage backends
let localforageData: Record<string, string> = {}
let sqliteData: Record<string, string> = {} // Mobile SQLite database
let localStorageData: Record<string, string> = {} // Mobile SQLite database

// Helper function to create old storage mock based on storage type
// This ensures old storage mocks match the actual storage implementations
function createOldStorageMock(
  type: 'INDEXEDDB' | 'LOCAL_STORAGE' | 'MOBILE_SQLITE',
  data: StorageData
) {
  // For INDEXEDDB: Data is stored in browser IndexedDB via localforage
  // For LOCAL_STORAGE: Data is stored in browser localStorage (legacy web)
  // For MOBILE_SQLITE: Data is stored in mobile SQLite database

  // Common storage operations factory
  const createStorageMock = (storageData: StorageData) => ({
    getStorageType: () => type,
    setStoreValue: vi.fn((key: string, value: unknown) => {
      storageData[key] = JSON.stringify(value)
      return Promise.resolve()
    }),
    getStoreValue: vi.fn((key: string) => {
      const val = storageData[key]
      return Promise.resolve(val ? JSON.parse(val) : null)
    }),
    delStoreValue: vi.fn((key: string) => {
      delete storageData[key]
      return Promise.resolve()
    }),
    getAllStoreValues: vi.fn(() => {
      const result: StorageData = {}
      for (const [key, value] of Object.entries(storageData)) {
        result[key] = JSON.parse(value)
      }
      return Promise.resolve(result)
    }),
    getAllStoreKeys: vi.fn(() => Promise.resolve(Object.keys(storageData))),
    setAllStoreValues: vi.fn(),
  })

  if (type === 'INDEXEDDB') {
    // IndexedDB storage: data stored via localforage (shared with current storage)
    // Populate localforageData with initial data
    for (const [key, value] of Object.entries(data)) {
      localforageData[key] = value
    }
    return createStorageMock(localforageData)
  } else if (type === 'LOCAL_STORAGE') {
    // Local storage: data stored in browser localStorage (independent copy for testing)
    localStorageData = { ...data }
    return createStorageMock(localStorageData)
  } else if (type === 'MOBILE_SQLITE') {
    // Mobile SQLite storage: data stored in SQLite database (independent copy)
    sqliteData = { ...data }
    return createStorageMock(sqliteData)
  }

  // Fallback for other types (not implemented in current tests)
  return {
    getStorageType: () => type,
    setStoreValue: vi.fn(),
    getStoreValue: vi.fn().mockResolvedValue(null),
    delStoreValue: vi.fn(),
    getAllStoreValues: vi.fn().mockResolvedValue({}),
    getAllStoreKeys: vi.fn().mockResolvedValue([]),
    setAllStoreValues: vi.fn(),
  }
}

// Create mock localforage instance
const mockLocalforageInstance = {
  getItem: vi.fn((key: string) => {
    const value = localforageData[key]
    return Promise.resolve(value ?? null)
  }),
  setItem: vi.fn((key: string, value: string) => {
    localforageData[key] = value
    return Promise.resolve(undefined)
  }),
  removeItem: vi.fn((key: string) => {
    delete localforageData[key]
    return Promise.resolve(undefined)
  }),
  keys: vi.fn(() => {
    return Promise.resolve(Object.keys(localforageData))
  }),
  iterate: vi.fn((callback: (value: string, key: string) => void) => {
    for (const [key, value] of Object.entries(localforageData)) {
      callback(value, key)
    }
    return Promise.resolve()
  }),
}

// Setup global mocks before any imports
global.window = {} as never

global.localStorage = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

// Platform implementations will be dynamically imported
import type { Platform } from '@/platform/interfaces'

// Current platform and instances - will be initialized after mocks
let currentPlatform!: Platform
let mobilePlatform: Platform

// Mock @/platform to return our platform instance
vi.mock('@/platform', () => ({
  get default() {
    return currentPlatform
  },
}))

// Mock localforage
vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => mockLocalforageInstance),
  },
}))

// Mock Capacitor modules to avoid "document is not defined" errors
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    getInfo: vi.fn(() => Promise.resolve({ version: '1.0.0', build: '1' })),
    getLaunchUrl: vi.fn(() => Promise.resolve(null)),
  },
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: vi.fn(),
}))

// Mock only external dependencies, not storage or platform
vi.mock('@/setup/init_data', () => ({
  initData: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../platform/storages', () => ({
  getOldVersionStorages: vi.fn(() => []),
  LocalStorage: vi.fn(),
  IndexedDBStorage: vi.fn(),
  MobileSQLiteStorage: class MockMobileSQLiteStorage {
    getStorageType() {
      return 'MOBILE_SQLITE'
    }
    setStoreValue(key: string, value: unknown) {
      sqliteData[key] = JSON.stringify(value)
      return Promise.resolve()
    }
    getStoreValue(key: string) {
      const json = sqliteData[key]
      return Promise.resolve(json ? JSON.parse(json) : null)
    }
    delStoreValue(key: string) {
      delete sqliteData[key]
      return Promise.resolve()
    }
    getAllStoreValues() {
      const items: { [key: string]: unknown } = {}
      for (const key in sqliteData) {
        try {
          items[key] = JSON.parse(sqliteData[key])
        } catch {
          items[key] = sqliteData[key]
        }
      }
      return Promise.resolve(items)
    }
    getAllStoreKeys() {
      return Promise.resolve(Object.keys(sqliteData))
    }
    async setAllStoreValues(data: { [key: string]: unknown }) {
      for (const [key, value] of Object.entries(data)) {
        await this.setStoreValue(key, value)
      }
    }
  },
}))

vi.mock('../../shared/defaults', async (importOriginal) => {
  const defaults = await importOriginal<typeof import('../../shared/defaults')>()
  return {
    ...defaults,
    SystemProviders: vi.fn(() => []),
  }
})

vi.mock('../lib/utils', () => ({
  getLogger: () => ({
    info: (...args: unknown[]) => console.log(...args),
    error: vi.fn(),
  }),
}))

vi.mock('./atoms/utilAtoms', () => ({
  migrationProcessAtom: {},
}))

vi.mock('./sessionHelpers', () => ({
  getSessionMeta: vi.fn((session) => ({
    id: session.id,
    name: session.name,
  })),
}))

vi.mock('@/platform/web_platform', () => ({
  default: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  getCurrentScope: () => ({
    setTag: vi.fn(),
  }),
}))

vi.mock('jotai', () => ({
  getDefaultStore: vi.fn(() => ({
    set: vi.fn(),
    get: vi.fn(() => []),
  })),
}))

vi.mock('store', () => ({
  default: {
    each: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@/packages/initial_data', () => ({
  artifactSessionCN: { id: 'artifact-cn' },
  artifactSessionEN: { id: 'artifact-en' },
  defaultSessionsForCN: [],
  defaultSessionsForEN: [],
  imageCreatorSessionForCN: { id: 'image-cn' },
  imageCreatorSessionForEN: { id: 'image-en' },
  mermaidSessionCN: { id: 'mermaid-cn' },
  mermaidSessionEN: { id: 'mermaid-en' },
}))

vi.mock('@shared/utils/cache', () => ({
  cache: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/i18n/parser', () => ({
  parseLocale: vi.fn((locale: string) => locale),
}))

vi.mock('../packages/navigator', () => ({
  getOS: vi.fn(() => 'test-os'),
  getBrowser: vi.fn(() => 'test-browser'),
}))

describe('migrateStorage test', () => {
  // Initialize platform instances after all mocks are set up
  beforeAll(async () => {
    const { default: MobilePlatformClass } = await import('@/platform/mobile_platform')

    mobilePlatform = new MobilePlatformClass()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    currentPlatform = mobilePlatform
    // Clear all storage data before each test
    localforageData = {}
    sqliteData = {}
  })

  it('should skip migration when old storage has same type as current storage', async () => {
    const { getOldVersionStorages } = await import('@/platform/storages')
    const { initData } = await import('@/setup/init_data')


    // Current storage already has some version (simulating an existing installation)
    sqliteData[StorageKey.ConfigVersion] = JSON.stringify(12)

    // Old storage is also MOBILE_SQLITE (same type)
    // In this test, we simulate finding an old storage with different version
    // (In reality, if they're the same type, they'd read the same data source,
    //  but for testing the skip logic, we use separate data containers)
    const oldStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'old-key' }),
    }

    const mockOldStorage = createOldStorageMock('MOBILE_SQLITE', oldStorageData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('@/stores/migration')

    await migration._migrateStorageForTest()

    // For mobile platform, migration uses getAllStoreKeys and getStoreValue
    expect(mockOldStorage.getStoreValue).toHaveBeenCalledExactlyOnceWith(StorageKey.ConfigVersion)
    expect(mockOldStorage.getAllStoreKeys).not.toHaveBeenCalled()
    expect(mockOldStorage.setStoreValue).not.toHaveBeenCalled()
    expect(mockOldStorage.setAllStoreValues).not.toHaveBeenCalled()
    expect(initData).not.toHaveBeenCalled()
  })

  it('should migrate from localStorage (v1.9.8) to SQLite (v1.17.0) on mobile', async () => {
    const { getOldVersionStorages } = await import('@/platform/storages')
    const { initData } = await import('@/setup/init_data')


    // Setup: Mobile v1.9.8 used localStorage with config version 5
    // This simulates a user upgrading directly from v1.9.8 to v1.17.0
    const oldLocalStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark', language: 'en' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'test-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: '1' }, { id: '2' }]),
      'session:1': JSON.stringify({ id: '1', name: 'Chat 1', messages: [] }),
      'session:2': JSON.stringify({ id: '2', name: 'Chat 2', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('LOCAL_STORAGE', oldLocalStorageData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Mobile should copy all keys from localStorage to SQLite
    // Migration condition: oldConfigVersion (5) > configVersion (0) ✓ && storage types differ ✓
    expect(mockOldStorage.getAllStoreKeys).toHaveBeenCalled()

    // All data should be migrated to SQLite
    expect(sqliteData[StorageKey.ConfigVersion]).toBeDefined()
    expect(sqliteData[StorageKey.Settings]).toBeDefined()
    expect(sqliteData[StorageKey.Configs]).toBeDefined()
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(sqliteData['session:1']).toBeDefined()
    expect(sqliteData['session:2']).toBeDefined()

    // Should mark as migrated in old storage
    expect(mockOldStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from LOCAL_STORAGE to MOBILE_SQLITE')
    )

    expect(initData).not.toHaveBeenCalled()
  })

  it('should migrate from IndexedDB (v1.16.1) to SQLite (v1.17.0) on mobile', async () => {
    const { getOldVersionStorages } = await import('@/platform/storages')
    const { initData } = await import('@/setup/init_data')


    // Setup: Mobile v1.16.1 used IndexedDB with config version 12
    // This simulates a user upgrading from v1.16.1 to v1.17.0
    const oldIndexedDBData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light', language: 'zh' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'indexeddb-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'a' }, { id: 'b' }]),
      'session:a': JSON.stringify({ id: 'a', name: 'Session A', messages: [] }),
      'session:b': JSON.stringify({ id: 'b', name: 'Session B', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('INDEXEDDB', oldIndexedDBData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Mobile should copy all keys from IndexedDB to SQLite
    expect(mockOldStorage.getAllStoreKeys).toHaveBeenCalled()

    // All data should be migrated to SQLite
    expect(sqliteData[StorageKey.ConfigVersion]).toBeDefined()
    expect(sqliteData[StorageKey.Settings]).toBeDefined()
    expect(sqliteData[StorageKey.Configs]).toBeDefined()
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
    expect(sqliteData['session:a']).toBeDefined()
    expect(sqliteData['session:b']).toBeDefined()

    // Should mark as migrated
    expect(mockOldStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from INDEXEDDB to MOBILE_SQLITE')
    )

    expect(initData).not.toHaveBeenCalled()
  })

  it('should handle multiple old storages and pick the newest one (mobile: localStorage v5 + IndexedDB v12)', async () => {
    const { getOldVersionStorages } = await import('@/platform/storages')
    const { initData } = await import('@/setup/init_data')


    // Scenario: User upgraded from v1.9.8 → v1.16.1 → v1.17.0
    // This left data in both localStorage (version 5) and IndexedDB (version 12)
    // Migration should pick IndexedDB (version 12) as it's newer

    const oldLocalStorageData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(5),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'old1' }]),
      'session:old1': JSON.stringify({ id: 'old1', name: 'Old Session', messages: [] }),
    }

    const oldIndexedDBData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(12),
      [StorageKey.Settings]: JSON.stringify({ theme: 'light' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'new1' }, { id: 'new2' }]),
      'session:new1': JSON.stringify({ id: 'new1', name: 'New Session 1', messages: [] }),
      'session:new2': JSON.stringify({ id: 'new2', name: 'New Session 2', messages: [] }),
    }

    const mockLocalStorage = createOldStorageMock('LOCAL_STORAGE', oldLocalStorageData)
    const mockIndexedDBStorage = createOldStorageMock('INDEXEDDB', oldIndexedDBData)

    // Return both storages - migration should pick the newest (IndexedDB v12)

    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockLocalStorage, mockIndexedDBStorage])

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Should migrate from IndexedDB (newer) not localStorage
    expect(mockIndexedDBStorage.getAllStoreKeys).toHaveBeenCalled()
    expect(mockLocalStorage.getAllStoreKeys).not.toHaveBeenCalled()

    // Data from IndexedDB should be in SQLite
    const sessionListData = JSON.parse(sqliteData[StorageKey.ChatSessionsList] || '[]')
    expect(sessionListData).toEqual([{ id: 'new1' }, { id: 'new2' }])
    expect(sqliteData['session:new1']).toBeDefined()
    expect(sqliteData['session:new2']).toBeDefined()

    // Old data from localStorage should NOT be migrated
    expect(sqliteData['session:old1']).toBeUndefined()

    // Should mark IndexedDB as migrated
    expect(mockIndexedDBStorage.setStoreValue).toHaveBeenCalledWith(
      'migrated',
      expect.stringContaining('migrated from INDEXEDDB to MOBILE_SQLITE')
    )

    // localStorage should NOT be marked as migrated
    expect(mockLocalStorage.setStoreValue).not.toHaveBeenCalled()

    expect(initData).not.toHaveBeenCalled()
  })

  it('should handle mobile migration with SQLite v7 data (v1.9.11 to v1.17.0)', async () => {
    const { getOldVersionStorages } = await import('@/platform/storages')
    const { initData } = await import('@/setup/init_data')


    // Setup: Mobile v1.9.11 used SQLite with config version 7
    // User stayed on v1.9.11 and never upgraded to v1.16.1
    // Now upgrading directly to v1.17.0 (which also uses SQLite)
    //
    // IMPORTANT: Since both old and current storage are MOBILE_SQLITE,
    // they share the same data source (sqliteData). So when old storage
    // has data, current storage already has access to it.
    const oldSQLiteData: StorageData = {
      [StorageKey.ConfigVersion]: JSON.stringify(7),
      [StorageKey.Settings]: JSON.stringify({ theme: 'dark' }),
      [StorageKey.Configs]: JSON.stringify({ apiKey: 'sqlite-v7-key' }),
      [StorageKey.ChatSessionsList]: JSON.stringify([{ id: 'sql1' }]),
      'session:sql1': JSON.stringify({ id: 'sql1', name: 'SQLite Session', messages: [] }),
    }

    const mockOldStorage = createOldStorageMock('MOBILE_SQLITE', oldSQLiteData)
    ;(getOldVersionStorages as ReturnType<typeof vi.fn>).mockReturnValueOnce([mockOldStorage])

    const migration = await import('@/stores/migration')
    await migration._migrateStorageForTest()

    // Current storage reads configVersion from sqliteData, which is 7 (not 0)
    // Since configVersion (7) < CurrentVersion (13), it checks for migration
    // But since old and current storage are same type, no migration occurs
    // And since configVersion is NOT 0, initData() is also not called

    // Only configVersion should be checked from old storage
    expect(mockOldStorage.getStoreValue).toHaveBeenCalledWith(StorageKey.ConfigVersion)
    expect(mockOldStorage.getAllStoreKeys).not.toHaveBeenCalled()
    expect(mockOldStorage.setStoreValue).not.toHaveBeenCalled()

    // No initData() because configVersion is 7, not 0
    expect(initData).not.toHaveBeenCalled()

    // Data is already accessible through sqliteData
    expect(sqliteData[StorageKey.ConfigVersion]).toBe(JSON.stringify(7))
    expect(sqliteData[StorageKey.ChatSessionsList]).toBeDefined()
  })

})
