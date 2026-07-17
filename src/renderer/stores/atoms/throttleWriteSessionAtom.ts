import type { Session } from '@shared/types'
import { atom, getDefaultStore, type SetStateAction, type WritableAtom } from 'jotai'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'

const sessionAtomCache = new Map<string, WritableAtom<Session | null, [SetStateAction<Session | null>], void>>()

const _createSessionAtom = (sessionId: string) => {
  if (sessionAtomCache.has(sessionId)) {
    return sessionAtomCache.get(sessionId)!
  }

  const at = atom<Session | null>(null)
  sessionAtomCache.set(sessionId, at)
  // 第一次初始化的时候，从本地存储读取
  const store = getDefaultStore()
  storage.getItem(StorageKeyGenerator.session(sessionId), null).then((value) => {
    store.set(at, value)
  })
  return at
}

class WriteQueue {
  private queue: {
    sessionId: string
    update: SetStateAction<Session | null>
  }[] = []
  private flushInterval: number = 2000
  private timer: NodeJS.Timeout | null = null

  constructor() {}

  private flush() {
    this.timer = null
    const groupedItems = this.queue.reduce(
      (acc, item) => {
        if (!acc[item.sessionId]) {
          acc[item.sessionId] = []
        }
        acc[item.sessionId].push(item)
        return acc
      },
      {} as Record<string, typeof this.queue>
    )

    Object.entries(groupedItems).forEach(async ([sessionId, items]) => {
      let storageItem = await storage.getItem<Session | null>(StorageKeyGenerator.session(sessionId), null)
      for (const { update } of items) {
        if (typeof update === 'function') {
          storageItem = update(storageItem)
        } else {
          storageItem = update
        }
      }
      storage.setItemNow(StorageKeyGenerator.session(sessionId), storageItem)
    })
    this.queue.length = 0
  }

  push(sessionId: string, update: SetStateAction<Session | null>) {
    this.queue.push({ sessionId, update })
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval)
    }
  }
}
const writeQueue = new WriteQueue()

const throttleWriteSessionAtomCache = new Map<
  string,
  WritableAtom<Session | null, [SetStateAction<Session | null>], void>
>()

export function createSessionAtom(sessionId: string) {
  if (throttleWriteSessionAtomCache.has(sessionId)) {
    return throttleWriteSessionAtomCache.get(sessionId)!
  }

  const throttleWriteSessionAtom = atom(
    (get) => {
      // init 从 storage 读取
      return get(_createSessionAtom(sessionId))
    },
    (get, set, update: SetStateAction<Session | null>) => {
      writeQueue.push(sessionId, update)
      set(_createSessionAtom(sessionId), update)
    }
  )
  throttleWriteSessionAtomCache.set(sessionId, throttleWriteSessionAtom)
  return throttleWriteSessionAtom
}

/**
 * Clean up session atom caches when a session is deleted to prevent memory leaks.
 * Should be called from deleteSession in chatStore.
 */
export function cleanupSessionAtomCache(sessionId: string) {
  sessionAtomCache.delete(sessionId)
  throttleWriteSessionAtomCache.delete(sessionId)
}
