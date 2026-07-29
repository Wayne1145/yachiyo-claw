import type { CodingArtifact, CodingBuildRun, CodingChangeSet, CodingProjectRecord } from '@shared/types'

const DB_NAME = 'yachiyo-coding-projects'
const DB_VERSION = 1

type CodingRecord = CodingProjectRecord | CodingChangeSet | CodingBuildRun | CodingArtifact
type StoreName = 'projects' | 'changesets' | 'builds' | 'artifacts'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class CodingProjectStorage {
  private dbPromise?: Promise<IDBDatabase>

  private database(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const name of ['projects', 'changesets', 'builds', 'artifacts'] as StoreName[]) {
          if (db.objectStoreNames.contains(name)) continue
          const store = db.createObjectStore(name, { keyPath: 'id' })
          store.createIndex(name === 'projects' ? 'updatedAt' : 'projectId', name === 'projects' ? 'updatedAt' : 'projectId')
        }
      }
    })
    return this.dbPromise
  }

  private async store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.database()).transaction(name, mode).objectStore(name)
  }

  async put<T extends CodingRecord>(name: StoreName, record: T): Promise<T> {
    await requestResult((await this.store(name, 'readwrite')).put(record))
    return record
  }

  async get<T extends CodingRecord>(name: StoreName, id: string): Promise<T | null> {
    return (await requestResult((await this.store(name, 'readonly')).get(id))) || null
  }

  async delete(name: StoreName, id: string): Promise<void> {
    await requestResult((await this.store(name, 'readwrite')).delete(id))
  }

  async list<T extends CodingRecord>(name: StoreName, projectId?: string): Promise<T[]> {
    const store = await this.store(name, 'readonly')
    if (name === 'projects') {
      const records = (await requestResult(store.getAll())) as T[]
      return records.sort((left, right) => Number((right as CodingProjectRecord).updatedAt) - Number((left as CodingProjectRecord).updatedAt))
    }
    return (await requestResult(store.index('projectId').getAll(projectId))) as T[]
  }
}

export const codingProjectStorage = new CodingProjectStorage()
