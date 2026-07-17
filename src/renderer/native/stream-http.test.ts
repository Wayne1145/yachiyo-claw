import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  type Listener = (data: never) => void
  const listeners = new Map<string, Set<Listener>>()
  const removers: ReturnType<typeof vi.fn>[] = []

  const addListener = vi.fn((eventName: string, listener: Listener) => {
    const eventListeners = listeners.get(eventName) ?? new Set<Listener>()
    eventListeners.add(listener)
    listeners.set(eventName, eventListeners)
    const remove = vi.fn(() => eventListeners.delete(listener))
    removers.push(remove)
    return Promise.resolve({ remove })
  })
  const startStream = vi.fn(() => Promise.resolve({ id: 'stream-1' }))
  const cancelStream = vi.fn(() => Promise.resolve(undefined))
  const emit = (eventName: string, data: unknown) => {
    for (const listener of listeners.get(eventName) ?? []) {
      listener(data as never)
    }
  }

  return { addListener, cancelStream, emit, listeners, removers, startStream }
})

vi.mock('capacitor-stream-http', () => ({
  StreamHttp: {
    addListener: testState.addListener,
    cancelStream: testState.cancelStream,
    startStream: testState.startStream,
  },
}))

import { createNativeReadableStream } from './stream-http'

describe('native stream HTTP lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.listeners.clear()
    testState.removers.length = 0
    testState.startStream.mockResolvedValue({ id: 'stream-1' })
    testState.cancelStream.mockResolvedValue(undefined)
  })

  it('uses response metadata emitted before chunks and removes every listener at end', async () => {
    testState.startStream.mockImplementationOnce(() => {
      // Exercise defensive queuing even if a bridge delivers events before its promise continuation runs.
      testState.emit('response', {
        id: 'stream-1',
        status: 201,
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-7' },
      })
      testState.emit('chunk', { id: 'stream-1', chunk: 'data: first\n\n' })
      testState.emit('end', { id: 'stream-1' })
      return Promise.resolve({ id: 'stream-1' })
    })

    const nativeResponse = await createNativeReadableStream({
      url: 'https://provider.example/v1/responses',
      method: 'POST',
    })

    expect(nativeResponse.status).toBe(201)
    expect(nativeResponse.headers).toEqual({
      'content-type': 'text/event-stream',
      'x-request-id': 'request-7',
    })
    await expect(new Response(nativeResponse.stream).text()).resolves.toBe('data: first\n\n')
    expect(testState.removers).toHaveLength(4)
    expect(testState.removers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  it('aborts a locked stream, cancels its native connection, and removes abort/listener hooks', async () => {
    const abortController = new AbortController()
    const removeAbortListener = vi.spyOn(abortController.signal, 'removeEventListener')
    const pendingResponse = createNativeReadableStream(
      { url: 'https://provider.example/v1/chat/completions', method: 'POST' },
      abortController.signal
    )
    await vi.waitFor(() => expect(testState.startStream).toHaveBeenCalledOnce())
    testState.emit('response', {
      id: 'stream-1',
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const nativeResponse = await pendingResponse
    const reader = nativeResponse.stream.getReader()
    const pendingRead = reader.read()

    abortController.abort()

    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(testState.cancelStream).toHaveBeenCalledWith({ id: 'stream-1' }))
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(testState.removers).toHaveLength(4)
    expect(testState.removers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  it('cancels and rejects when aborted before response metadata arrives', async () => {
    const abortController = new AbortController()
    const pendingResponse = createNativeReadableStream(
      { url: 'https://provider.example/v1/responses', method: 'POST' },
      abortController.signal
    )
    await vi.waitFor(() => expect(testState.startStream).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(pendingResponse).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(testState.cancelStream).toHaveBeenCalledWith({ id: 'stream-1' }))
    expect(testState.removers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })
})
