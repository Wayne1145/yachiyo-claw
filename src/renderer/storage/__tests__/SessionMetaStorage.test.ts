import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionMetaRecord } from '@shared/types'
import { IndexedDBSessionMetaStorage } from '../SessionMetaStorage'

function makeRecord(overrides: Partial<SessionMetaRecord> & { id: string }): SessionMetaRecord {
  return {
    name: 'Test Session',
    sortOrder: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  }
}

// Use unique DB names to avoid cross-test interference
let dbCounter = 0

// Subclass to inject unique DB names per test
class TestSessionMetaStorage extends IndexedDBSessionMetaStorage {
  constructor(dbName: string) {
    super()
    // Override the private DB_NAME by re-implementing openDatabase
    ;(this as unknown as { openDatabase: () => Promise<void> }).openDatabase = () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          ;(this as unknown as { db: IDBDatabase }).db = request.result
          resolve()
        }
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          if (!db.objectStoreNames.contains('records')) {
            const store = db.createObjectStore('records', { keyPath: 'id' })
            store.createIndex('sortOrder', 'sortOrder', { unique: false })
            store.createIndex('createdAt', 'createdAt', { unique: false })
          }
        }
      })
    }
  }
}

describe('IndexedDBSessionMetaStorage', () => {
  let storage: IndexedDBSessionMetaStorage

  beforeEach(() => {
    storage = new TestSessionMetaStorage(`test-db-${++dbCounter}`)
  })

  it('create and getById', async () => {
    const record = makeRecord({ id: 'test-1', name: 'Hello' })
    await storage.create(record)
    const result = await storage.getById('test-1')
    expect(result).toEqual(record)
  })

  it('getById returns null for non-existent', async () => {
    await storage.initialize()
    const result = await storage.getById('non-existent')
    expect(result).toBeNull()
  })

  it('update existing record', async () => {
    const record = makeRecord({ id: 'test-1', name: 'Original' })
    await storage.create(record)

    const updated = await storage.update('test-1', { name: 'Updated' })
    expect(updated?.name).toBe('Updated')
    expect(updated?.id).toBe('test-1')

    const fetched = await storage.getById('test-1')
    expect(fetched?.name).toBe('Updated')
  })

  it('update non-existent returns null', async () => {
    await storage.initialize()
    const result = await storage.update('non-existent', { name: 'nope' })
    expect(result).toBeNull()
  })

  it('delete removes record', async () => {
    const record = makeRecord({ id: 'test-1' })
    await storage.create(record)
    await storage.delete('test-1')
    const result = await storage.getById('test-1')
    expect(result).toBeNull()
  })

  it('deleteMany removes selected records', async () => {
    await storage.createMany([
      makeRecord({ id: 'a', sortOrder: 100 }),
      makeRecord({ id: 'b', sortOrder: 200 }),
      makeRecord({ id: 'c', sortOrder: 300 }),
    ])

    await storage.deleteMany(['a', 'c'])

    expect(await storage.getById('a')).toBeNull()
    expect(await storage.getById('c')).toBeNull()
    expect((await storage.getById('b'))?.id).toBe('b')
    expect(await storage.getTotal()).toBe(1)
  })

  it('getAll sorts starred first, then by sortOrder desc', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 300, starred: true }))
    await storage.create(makeRecord({ id: 'c', sortOrder: 200 }))
    await storage.create(makeRecord({ id: 'd', sortOrder: 400, starred: true }))

    const all = await storage.getAll()
    expect(all.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('getAll filters out hidden records', async () => {
    await storage.create(makeRecord({ id: 'visible', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'hidden', sortOrder: 200, hidden: true }))

    const all = await storage.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('visible')
  })

  it('createMany batch inserts', async () => {
    const records = [
      makeRecord({ id: 'a', sortOrder: 100 }),
      makeRecord({ id: 'b', sortOrder: 200 }),
      makeRecord({ id: 'c', sortOrder: 300 }),
    ]
    await storage.createMany(records)
    const total = await storage.getTotal()
    expect(total).toBe(3)
  })

  it('createMany with empty array is no-op', async () => {
    await storage.createMany([])
    const total = await storage.getTotal()
    expect(total).toBe(0)
  })

  it('getTotal returns 0 for empty DB', async () => {
    await storage.initialize()
    expect(await storage.getTotal()).toBe(0)
  })

  it('getTotal counts all records including hidden', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200, hidden: true }))
    expect(await storage.getTotal()).toBe(2)
  })

  describe('getPage', () => {
    it('returns first page with correct nextCursor', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.create(makeRecord({ id: `s${i}`, sortOrder: i * 1000 }))
      }
      const page = await storage.getPage(0, 2)
      expect(page.items).toHaveLength(2)
      expect(page.nextCursor).toBe(2)
      expect(page.total).toBe(5)
    })

    it('returns last page with nextCursor null', async () => {
      for (let i = 0; i < 3; i++) {
        await storage.create(makeRecord({ id: `s${i}`, sortOrder: i * 1000 }))
      }
      const page = await storage.getPage(2, 2)
      expect(page.items).toHaveLength(1)
      expect(page.nextCursor).toBeNull()
    })

    it('returns empty page for empty DB', async () => {
      await storage.initialize()
      const page = await storage.getPage(0, 10)
      expect(page.items).toEqual([])
      expect(page.nextCursor).toBeNull()
      expect(page.total).toBe(0)
    })

    it('excludes hidden records from pages', async () => {
      await storage.create(makeRecord({ id: 'visible1', sortOrder: 300 }))
      await storage.create(makeRecord({ id: 'hidden1', sortOrder: 200, hidden: true }))
      await storage.create(makeRecord({ id: 'visible2', sortOrder: 100 }))

      const page = await storage.getPage(0, 10)
      expect(page.items).toHaveLength(2)
      expect(page.items.map((r) => r.id)).toEqual(['visible1', 'visible2'])
      expect(page.total).toBe(2)
    })

    it('respects sorted order (starred first) across pages', async () => {
      await storage.create(makeRecord({ id: 'r1', sortOrder: 300 }))
      await storage.create(makeRecord({ id: 'p1', sortOrder: 100, starred: true }))
      await storage.create(makeRecord({ id: 'r2', sortOrder: 200 }))

      const page1 = await storage.getPage(0, 2)
      const page2 = await storage.getPage(2, 2)
      expect(page1.items.map((r) => r.id)).toEqual(['p1', 'r1'])
      expect(page2.items.map((r) => r.id)).toEqual(['r2'])
      expect(page2.nextCursor).toBeNull()
    })
  })

  it('clear removes all records', async () => {
    await storage.create(makeRecord({ id: 'a', sortOrder: 100 }))
    await storage.create(makeRecord({ id: 'b', sortOrder: 200 }))
    expect(await storage.getTotal()).toBe(2)
    await storage.clear()
    expect(await storage.getTotal()).toBe(0)
    expect(await storage.getAll()).toEqual([])
  })
})
