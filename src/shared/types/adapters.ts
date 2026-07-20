import type { SentryAdapter } from '../utils/sentry_adapter'
import type { OAuthCredentials } from '../oauth/types'

export interface ApiRequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: RequestInit['body']
  useProxy?: boolean
  signal?: AbortSignal
  retry?: number
}

export interface StorageAdapter {
  saveImage(folder: string, dataUrl: string): Promise<string>
  getImage(storageKey: string): Promise<string>
}

export interface OAuthAdapter {
  refreshCredential(providerId: string, credential: OAuthCredentials): Promise<OAuthCredentials>
  persistCredential(providerId: string, credential: OAuthCredentials): void
  clearCredential(providerId: string): void
}

export interface RequestAdapter {
  fetchWithOptions(
    url: string,
    init?: RequestInit,
    options?: { retry?: number; parseChatboxRemoteError?: boolean }
  ): Promise<Response>
  apiRequest(options: ApiRequestOptions): Promise<Response>
}

/** Optional native/local inference boundary. Shared models never import Capacitor. */
export interface LocalInferenceAdapter {
  isAvailable(modelId: string): Promise<boolean>
  stream(
    modelId: string,
    input: {
      messages: unknown[]
      tools?: unknown
      signal?: AbortSignal
    }
  ): AsyncGenerator<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; name: string; arguments: unknown; callId: string }
    | { type: 'status'; status: string }
  >
  unload?(modelId?: string): Promise<void>
}

export interface ModelDependencies {
  request: RequestAdapter
  storage: StorageAdapter
  sentry: SentryAdapter
  getRemoteConfig(): any
  oauth?: OAuthAdapter
  /** Current platform type, used for OAuth auth resolution */
  platformType?: 'desktop' | 'web' | 'mobile'
  /** Native LiteRT-LM/llama.cpp adapter; absent for ordinary cloud providers. */
  localInference?: LocalInferenceAdapter
}
