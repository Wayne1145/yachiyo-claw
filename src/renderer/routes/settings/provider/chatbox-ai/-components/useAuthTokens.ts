import { useCallback, useMemo } from 'react'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import * as premiumActions from '@/stores/premiumActions'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import type { AuthTokens } from './types'

export function useAuthTokens() {
  const accessToken = useAuthInfoStore((state) => state.accessToken)
  const refreshToken = useAuthInfoStore((state) => state.refreshToken)

  const isLoggedIn = useMemo(() => {
    return !!accessToken && !!refreshToken
  }, [accessToken, refreshToken])

  const saveAuthTokens = useCallback(async (tokens: AuthTokens) => {
    try {
      await authInfoStore.getState().setTokens(tokens)
    } catch (error) {
      console.error('❌ Failed to save tokens:', error)
      throw error
    }
  }, [])

  const clearAuthTokens = useCallback(async () => {
    try {
      const settings = settingsStore.getState()
      if (settings.licenseActivationMethod === 'login') {
        await premiumActions.deactivate()
      }

      settingsStore.setState({ hasExpiredLicense: false })

      authInfoStore.getState().clearTokens()

      queryClient.removeQueries({ queryKey: ['userProfile'] })
      queryClient.removeQueries({ queryKey: ['userLicenses'] })
      queryClient.removeQueries({ queryKey: ['licenseDetail'] })
      queryClient.removeQueries({ queryKey: ['license-detail'] })
    } catch (error) {
      console.error('Failed to clear auth tokens:', error)
    }
  }, [])

  return {
    isLoggedIn,
    clearAuthTokens,
    saveAuthTokens,
  }
}
