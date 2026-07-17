import { createFetchWithProxy } from '@shared/models/utils/fetch-proxy'
import type { OAuthCredentialManager } from '@shared/oauth/credential-manager'
import type { ModelDependencies } from '@shared/types/adapters'
import { headersToRecord } from './fetch-utils'

export function createCopilotOAuthFetch(
  dependencies: ModelDependencies,
  credentialManager: OAuthCredentialManager,
  options?: { useProxy?: boolean }
): typeof globalThis.fetch {
  const baseFetch = createFetchWithProxy(options?.useProxy, dependencies)

  return async (input, init) => {
    const token = await credentialManager.getAccessToken()
    const headers = new Headers(init?.headers)
    headers.delete('Authorization')
    headers.delete('x-api-key')
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Openai-Intent', 'conversation-edits')

    const response = await baseFetch(input, { ...init, headers: headersToRecord(headers) })
    if (response.status === 401 || response.status === 403) {
      credentialManager.clear()
    }
    return response
  }
}
