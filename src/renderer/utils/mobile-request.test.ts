import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/models/errors'

const testState = vi.hoisted(() => ({
  capacitorRequest: vi.fn(),
  createNativeReadableStream: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: testState.capacitorRequest },
}))

vi.mock('@/native/stream-http', () => ({
  createNativeReadableStream: testState.createNativeReadableStream,
}))

import { bodyRequestsStream, handleMobileRequest, normalizeMobileTimeouts } from './mobile-request'

function textStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

describe('mobile native requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.capacitorRequest.mockResolvedValue({ status: 200, headers: {}, data: 'ok' })
  })

  it('uses native response status and headers for a successful stream', async () => {
    testState.createNativeReadableStream.mockResolvedValue({
      stream: textStream('data: hello\n\n'),
      status: 206,
      headers: { 'content-type': 'text/event-stream', 'x-provider': 'openai-compatible' },
    })

    const response = await handleMobileRequest(
      'https://provider.example/v1/responses',
      'POST',
      new Headers({ Authorization: 'Bearer secret' }),
      JSON.stringify({ stream: true })
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('x-provider')).toBe('openai-compatible')
    await expect(response.text()).resolves.toBe('data: hello\n\n')
    expect(testState.createNativeReadableStream).toHaveBeenCalledWith(
      expect.objectContaining({
        connectTimeoutMs: 30_000,
        readTimeoutMs: 0,
        headers: expect.objectContaining({ accept: 'text/event-stream' }),
      }),
      undefined
    )
  })

  it('reads a non-2xx streaming body before throwing an ApiError with the real status', async () => {
    testState.createNativeReadableStream.mockResolvedValue({
      stream: textStream('{"error":{"message":"invalid key"}}'),
      status: 401,
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-9' },
    })

    const error = await handleMobileRequest(
      'https://provider.example/v1/chat/completions',
      'POST',
      new Headers(),
      JSON.stringify({ stream: true })
    ).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      statusCode: 401,
      responseBody: '{"error":{"message":"invalid key"}}',
    })
  })

  it('safely treats malformed JSON bodies as buffered native requests', async () => {
    expect(bodyRequestsStream('{not-json')).toBe(false)

    const response = await handleMobileRequest('https://provider.example/v1/models', 'POST', new Headers(), '{not-json')

    await expect(response.text()).resolves.toBe('ok')
    expect(testState.createNativeReadableStream).not.toHaveBeenCalled()
    expect(testState.capacitorRequest).toHaveBeenCalledOnce()
  })

  it('passes a buffered JSON string to CapacitorHttp without parsing or serializing it again', async () => {
    const rawBody = '{"model":"test","stream":false,"input":[{"role":"user","content":"hello"}]}'

    await handleMobileRequest('https://provider.example/v1/responses', 'POST', new Headers(), rawBody)

    expect(testState.capacitorRequest).toHaveBeenCalledWith(expect.objectContaining({ data: rawBody }))
  })

  it('removes the Abort listener after a buffered native request settles', async () => {
    const abortController = new AbortController()
    const removeAbortListener = vi.spyOn(abortController.signal, 'removeEventListener')

    await handleMobileRequest('https://provider.example/v1/models', 'GET', new Headers(), undefined, {
      signal: abortController.signal,
    })

    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('bounds configurable native timeouts while preserving an infinite read timeout', () => {
    expect(normalizeMobileTimeouts({})).toEqual({ connectTimeoutMs: 30_000, readTimeoutMs: 0 })
    expect(normalizeMobileTimeouts({ connectTimeoutMs: 999_999, readTimeoutMs: 9_999_999 })).toEqual({
      connectTimeoutMs: 120_000,
      readTimeoutMs: 3_600_000,
    })
    expect(() => normalizeMobileTimeouts({ readTimeoutMs: -1 })).toThrow(RangeError)
  })
})
