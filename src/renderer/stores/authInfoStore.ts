import { createStore, useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { AuthTokens } from '../routes/settings/provider/chatbox-ai/-components/types'
import { AUTH_INFO_STORAGE_KEY, getAuthInfoStateStorage } from './authInfoStorage'

interface AuthTokensState {
  accessToken: string | null
  refreshToken: string | null
}

interface AuthTokensActions {
  setTokens: (tokens: AuthTokens) => void
  clearTokens: () => void
  getTokens: () => AuthTokens | null
}

const initialState: AuthTokensState = {
  accessToken: null,
  refreshToken: null,
}

type AuthInfoState = AuthTokensState & AuthTokensActions

let handleAuthInfoHydrationError: (() => void) | undefined

export const authInfoStore = createStore<AuthInfoState>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        ...initialState,

        setTokens: (tokens: AuthTokens) => {
          set((state) => {
            state.accessToken = tokens.accessToken
            state.refreshToken = tokens.refreshToken
          })
        },

        clearTokens: () => {
          set((state) => {
            state.accessToken = null
            state.refreshToken = null
          })
        },

        getTokens: () => {
          const state = get()
          if (state.accessToken && state.refreshToken) {
            return {
              accessToken: state.accessToken,
              refreshToken: state.refreshToken,
            }
          }
          return null
        },
      })),
      {
        name: AUTH_INFO_STORAGE_KEY,
        storage: createJSONStorage(getAuthInfoStateStorage),
        version: 0,
        partialize: (state) => ({
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        }),
        onRehydrateStorage: () => (_state, error) => {
          if (error) {
            handleAuthInfoHydrationError?.()
          }
        },
        skipHydration: true,
      }
    )
  )
)

let initAuthInfoStorePromise: Promise<AuthInfoState> | undefined

export function initAuthInfoStore(): Promise<AuthInfoState> {
  if (initAuthInfoStorePromise) return initAuthInfoStorePromise
  if (authInfoStore.persist.hasHydrated()) {
    initAuthInfoStorePromise = Promise.resolve(authInfoStore.getState())
    return initAuthInfoStorePromise
  }

  initAuthInfoStorePromise = new Promise<AuthInfoState>((resolve) => {
    let settled = false
    let recoveryStarted = false

    const finish = () => {
      if (settled) return
      settled = true
      unsubscribeFinishHydration()
      handleAuthInfoHydrationError = undefined
      resolve(authInfoStore.getState())
    }

    const recoverSignedOutState = async () => {
      if (recoveryStarted) {
        finish()
        return
      }
      recoveryStarted = true

      try {
        await Promise.resolve(authInfoStore.setState(initialState))
      } catch {
        // The in-memory update happens before persistence; cleanup below removes any stale row.
      }

      try {
        await Promise.resolve(getAuthInfoStateStorage().removeItem(AUTH_INFO_STORAGE_KEY))
      } catch {
        finish()
        return
      }

      try {
        await Promise.resolve(authInfoStore.persist.rehydrate())
      } catch {
        finish()
      }
    }

    const unsubscribeFinishHydration = authInfoStore.persist.onFinishHydration(finish)
    handleAuthInfoHydrationError = () => {
      void recoverSignedOutState()
    }

    try {
      void Promise.resolve(authInfoStore.persist.rehydrate()).catch(() => recoverSignedOutState())
    } catch {
      void recoverSignedOutState()
    }
  })

  return initAuthInfoStorePromise
}

export function useAuthInfoStore<U>(selector: Parameters<typeof useStore<typeof authInfoStore, U>>[1]) {
  return useStore<typeof authInfoStore, U>(authInfoStore, selector)
}

export const useAuthTokens = () => {
  return useAuthInfoStore((state) => ({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    setTokens: state.setTokens,
    clearTokens: state.clearTokens,
    getTokens: state.getTokens,
  }))
}
