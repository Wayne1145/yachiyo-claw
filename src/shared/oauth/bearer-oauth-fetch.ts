import { createFetchWithProxy } from '@shared/models/utils/fetch-proxy'
import type { ModelDependencies } from '@shared/types/adapters'
import type { OAuthCredentialManager } from './credential-manager'
import { headersToRecord } from './fetch-utils'

export function createBearerOAuthFetch(
  dependencies: ModelDependencies,
  credentialManager: OAuthCredentialManager,
  options?: {
    useProxy?: boolean
    staticHeaders?: Record<string, string>
  }
): typeof globalThis.fetch {
  const baseFetch = createFetchWithProxy(options?.useProxy, dependencies)

  return async (input, init) => {
    const token = await credentialManager.getAccessToken()
    const headers = new Headers(init?.headers)
    headers.delete('Authorization')
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${token}`)

    for (const [key, value] of Object.entries(options?.staticHeaders || {})) {
      headers.set(key, value)
    }

    const response = await baseFetch(input, { ...init, headers: headersToRecord(headers) })
    if (response.status === 401 || response.status === 403) {
      credentialManager.clear()
    }
    return response
  }
}
