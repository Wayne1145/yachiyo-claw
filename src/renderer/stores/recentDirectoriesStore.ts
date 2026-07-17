import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'

const MAX_RECENT = 5

type State = {
  directories: string[]
}

export const recentDirectoriesStore = createStore(
  persist(
    combine({ directories: [] } as State, (set, get) => ({
      addDirectory: (dir: string) => {
        const current = get().directories
        const filtered = current.filter((d) => d !== dir)
        set({ directories: [dir, ...filtered].slice(0, MAX_RECENT) })
      },
    })),
    {
      name: 'recent-directories',
      version: 0,
      skipHydration: true,
      storage: safeStorage,
    }
  )
)

let initPromise: Promise<State> | undefined
export const initRecentDirectoriesStore = async () => {
  if (!initPromise) {
    initPromise = new Promise<State>((resolve) => {
      const unsub = recentDirectoriesStore.persist.onFinishHydration((val) => {
        unsub()
        resolve(val)
      })
      recentDirectoriesStore.persist.rehydrate()
    })
  }
  return initPromise
}

export function useRecentDirectories() {
  return useStore(recentDirectoriesStore, (s) => s.directories)
}
