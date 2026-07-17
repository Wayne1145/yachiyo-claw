import { CapacitorHttp } from '@capacitor/core'
import { createNativeReadableStream } from '@/native/stream-http'
import { ApiError } from '../../shared/models/errors'

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
const DEFAULT_READ_TIMEOUT_MS = 0
const MIN_TIMEOUT_MS = 1_000
const MAX_CONNECT_TIMEOUT_MS = 120_000
const MAX_READ_TIMEOUT_MS = 3_600_000

export interface MobileRequestOptions {
  signal?: AbortSignal
  connectTimeoutMs?: number
  readTimeoutMs?: number
}

function createAbortError(signal: AbortSignal): DOMException {
  const message = signal.reason instanceof Error ? signal.reason.message : 'The request was aborted.'
  return new DOMException(message, 'AbortError')
}

function normalizeTimeout(
  value: number | undefined,
  fallback: number,
  maximum: number,
  allowInfinite: boolean
): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Native HTTP timeouts must be finite, non-negative numbers.')
  }
  const integer = Math.trunc(value)
  if (allowInfinite && integer === 0) return 0
  return Math.min(Math.max(integer, MIN_TIMEOUT_MS), maximum)
}

export function normalizeMobileTimeouts(options: MobileRequestOptions): {
  connectTimeoutMs: number
  readTimeoutMs: number
} {
  return {
    connectTimeoutMs: normalizeTimeout(
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
      MAX_CONNECT_TIMEOUT_MS,
      false
    ),
    readTimeoutMs: normalizeTimeout(options.readTimeoutMs, DEFAULT_READ_TIMEOUT_MS, MAX_READ_TIMEOUT_MS, true),
  }
}

export function bodyRequestsStream(body?: RequestInit['body']): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(body)
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Reflect.get(parsed, 'stream') === true
    )
  } catch {
    return false
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

async function waitForBufferedResponse<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request
  if (signal.aborted) throw createAbortError(signal)

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(createAbortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([request, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function handleMobileRequest(
  url: string,
  method: string,
  headers: Headers,
  body?: RequestInit['body'],
  options: MobileRequestOptions = {}
): Promise<Response> {
  const { signal } = options
  if (signal?.aborted) throw createAbortError(signal)

  const timeouts = normalizeMobileTimeouts(options)
  const headerObj = headersToRecord(headers)
  const isStreaming = bodyRequestsStream(body)

  if (isStreaming) {
    const streamHeaders = new Headers(headers)
    streamHeaders.set('Accept', 'text/event-stream')
    const nativeResponse = await createNativeReadableStream(
      {
        url,
        method,
        headers: headersToRecord(streamHeaders),
        body: body as string,
        ...timeouts,
      },
      signal
    )

    if (nativeResponse.status < 200 || nativeResponse.status >= 300) {
      const errorBody = await new Response(nativeResponse.stream).text().catch(() => undefined)
      throw new ApiError(`Status Code ${nativeResponse.status}`, errorBody, nativeResponse.status)
    }

    const bodylessStatus = nativeResponse.status === 204 || nativeResponse.status === 205
    return new Response(bodylessStatus ? null : nativeResponse.stream, {
      status: nativeResponse.status,
      headers: nativeResponse.headers,
    })
  }

  const response = await waitForBufferedResponse(
    CapacitorHttp.request({
      url,
      method,
      headers: headerObj,
      data: body,
      responseType: 'text',
      connectTimeout: timeouts.connectTimeoutMs,
      readTimeout: timeouts.readTimeoutMs,
    }),
    signal
  )

  const rawData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(`Status Code ${response.status}`, rawData, response.status)
  }

  const bodylessStatus = response.status === 204 || response.status === 205
  return new Response(bodylessStatus ? null : rawData, {
    status: response.status,
    headers: response.headers,
  })
}
