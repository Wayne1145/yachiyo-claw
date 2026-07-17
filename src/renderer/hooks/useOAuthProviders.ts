import type { OAuthProviderInfo } from '@shared/oauth'
import { OAuthIpcChannels } from '@shared/oauth'
import { useEffect, useState } from 'react'
import platform from '@/platform'

/**
 * Hook to get the list of providers that support OAuth login.
 * Returns empty array on non-desktop platforms.
 */
export function useOAuthProviders(): OAuthProviderInfo[] {
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([])

  useEffect(() => {
    if (platform.type !== 'desktop') return
    ;(platform as any).ipc
      .invoke(OAuthIpcChannels.GET_SUPPORTED_PROVIDERS)
      .then((json: string) => setProviders(JSON.parse(json)))
      .catch(() => setProviders([]))
  }, [])

  return providers
}
