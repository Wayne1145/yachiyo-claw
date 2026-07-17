import platform from '@/platform'
import { ApiError, BaseError, NetworkError } from '../../shared/models/errors'
import { isLocalHost } from '../../shared/utils/network_utils'
import { handleMobileRequest } from './mobile-request'

interface RequestOptions {
  method: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  signal?: AbortSignal
  retry?: number
  useProxy?: boolean
  connectTimeoutMs?: number
  readTimeoutMs?: number
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function retryRequest<T>(fn: () => Promise<T>, retry: number, url: string): Promise<T> {
  let requestError: BaseError | null = null

  for (let i = 0; i <= retry; i++) {
    try {
      return await fn()
    } catch (error) {
      // API responses and explicit cancellation must not be replayed.
      if (error instanceof ApiError || isAbortError(error)) {
        throw error
      }
      let origin = 'unknown'
      try {
        origin = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin
      } catch {}
      const message = error instanceof Error ? error.message : 'Unknown request error'
      requestError = error instanceof BaseError ? error : new NetworkError(message, origin)

      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw requestError || new Error('Unknown error')
}

function buildHeaders(options: RequestOptions, url: string): Headers {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  if (options.useProxy && !isLocalHost(url) && platform.type !== 'mobile') {
    headers.set('CHATBOX-TARGET-URI', url)
    headers.set('CHATBOX-PLATFORM', platform.type)
  }

  return headers
}

async function doRequest(url: string, options: RequestOptions): Promise<Response> {
  const { signal, useProxy = false, body, method, connectTimeoutMs, readTimeoutMs } = options
  const retry = options.retry ?? (method.toUpperCase() === 'GET' ? 3 : 0)
  let requestUrl = url
  const headers = buildHeaders(options, url)

  if (useProxy && !isLocalHost(url) && platform.type !== 'mobile') {
    const version = await platform.getVersion()
    headers.set('CHATBOX-VERSION', version || 'unknown')
    requestUrl = 'https://cors-proxy.chatboxai.app/proxy-api/completions'
  }

  const makeRequest = async () => {
    // Android API traffic must bypass WebView fetch so every provider works without CORS exceptions.
    if (platform.type === 'mobile') {
      return handleMobileRequest(requestUrl, method, headers, body, { signal, connectTimeoutMs, readTimeoutMs })
    }

    const response = await fetch(requestUrl, { method, headers, body, signal })
    if (!response.ok) {
      const errorBody = await response.text().catch(() => null)
      throw new ApiError(`Status Code ${response.status}`, errorBody ?? undefined, response.status)
    }
    return response
  }

  return retryRequest(makeRequest, retry, requestUrl)
}

export const apiRequest = {
  post(url: string, headers: Record<string, string>, body: RequestInit['body'], options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'POST', headers, body })
  },

  get(url: string, headers: Record<string, string>, options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'GET', headers })
  },
}

export function fetchWithProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return doRequest(input.toString(), {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || undefined,
    useProxy: true,
  })
}
