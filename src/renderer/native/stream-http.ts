import {
  type StartStreamOptions,
  type StreamChunkEvent,
  type StreamEndEvent,
  type StreamErrorEvent,
  StreamHttp,
  type StreamResponseEvent,
} from 'capacitor-stream-http'

export type { StartStreamOptions } from 'capacitor-stream-http'
export { StreamHttp }

export interface NativeReadableResponse {
  stream: ReadableStream<Uint8Array>
  status: number
  headers: Record<string, string>
}

type ListenerRemover = () => void | Promise<void>
type PendingEvent =
  | { type: 'response'; data: StreamResponseEvent }
  | { type: 'chunk'; data: StreamChunkEvent }
  | { type: 'end'; data: StreamEndEvent }
  | { type: 'error'; data: StreamErrorEvent }

const MAX_PENDING_EVENTS = 128

function asError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback)
}

function createAbortError(signal: AbortSignal): DOMException {
  const message = signal.reason instanceof Error ? signal.reason.message : 'The request was aborted.'
  return new DOMException(message, 'AbortError')
}

function invokeRemover(remove: ListenerRemover): void {
  try {
    const result = remove()
    if (result && typeof result.catch === 'function') {
      void result.catch(() => undefined)
    }
  } catch {
    // Listener cleanup is best-effort and must not mask the request result.
  }
}

export async function createNativeReadableStream(
  options: StartStreamOptions,
  signal?: AbortSignal
): Promise<NativeReadableResponse> {
  if (signal?.aborted) {
    throw createAbortError(signal)
  }

  let streamId: string | null = null
  let controller: ReadableStreamDefaultController<Uint8Array>
  let responseRemover: ListenerRemover | null = null
  let finished = false
  let metadataSettled = false
  let terminalError: Error | null = null
  let cancelRequested = false
  let cancellationStarted = false
  let abortListenerAttached = false
  const removers = new Set<ListenerRemover>()
  const pendingEvents: PendingEvent[] = []
  const textEncoder = new TextEncoder()

  let resolveMetadata: (metadata: Omit<NativeReadableResponse, 'stream'>) => void
  let rejectMetadata: (error: Error) => void
  const metadataPromise = new Promise<Omit<NativeReadableResponse, 'stream'>>((resolve, reject) => {
    resolveMetadata = resolve
    rejectMetadata = reject
  })
  // Attach a handler immediately so an Abort during startStream cannot become an unhandled rejection.
  void metadataPromise.catch(() => undefined)

  const removeTrackedListener = (remove: ListenerRemover | null) => {
    if (!remove || !removers.delete(remove)) return
    invokeRemover(remove)
  }

  const cleanup = () => {
    for (const remove of removers) {
      invokeRemover(remove)
    }
    removers.clear()
    responseRemover = null
    if (signal && abortListenerAttached) {
      signal.removeEventListener('abort', onAbort)
      abortListenerAttached = false
    }
  }

  const cancelNative = async () => {
    if (!streamId || cancellationStarted) return
    cancellationStarted = true
    try {
      await StreamHttp.cancelStream({ id: streamId })
    } catch {
      // The stream may already have completed natively; local cleanup still has to finish.
    }
  }

  const fail = (error: Error, shouldCancel: boolean) => {
    if (finished) return
    finished = true
    terminalError = error
    cancelRequested ||= shouldCancel
    if (!metadataSettled) {
      metadataSettled = true
      rejectMetadata(error)
    }
    cleanup()
    try {
      controller.error(error)
    } catch {
      // The consumer may already have cancelled or closed the stream.
    }
    if (cancelRequested) {
      void cancelNative()
    }
  }

  const finish = () => {
    if (finished) return
    if (!metadataSettled) {
      fail(new Error('Native stream ended before response metadata was received.'), false)
      return
    }
    finished = true
    cleanup()
    controller.close()
  }

  const routeEvent = (event: PendingEvent) => {
    if (!streamId) {
      if (pendingEvents.length < MAX_PENDING_EVENTS) {
        pendingEvents.push(event)
      }
      return
    }
    if (event.data.id !== streamId || finished) return

    switch (event.type) {
      case 'response': {
        const { status, headers } = event.data
        if (!Number.isInteger(status)) {
          fail(new Error('Native stream returned invalid response metadata.'), true)
          return
        }
        metadataSettled = true
        removeTrackedListener(responseRemover)
        responseRemover = null
        resolveMetadata({ status, headers: headers ?? {} })
        return
      }
      case 'chunk':
        controller.enqueue(textEncoder.encode(event.data.chunk ?? ''))
        return
      case 'end':
        finish()
        return
      case 'error':
        fail(new Error(event.data.error || 'Native stream error'), false)
    }
  }

  const retainListener = (remove: ListenerRemover) => {
    if (finished) {
      invokeRemover(remove)
    } else {
      removers.add(remove)
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
    async cancel() {
      if (finished) return
      finished = true
      cancelRequested = true
      if (!metadataSettled) {
        metadataSettled = true
        rejectMetadata(new Error('Native stream was cancelled before response metadata was received.'))
      }
      cleanup()
      await cancelNative()
    },
  })

  function onAbort() {
    if (!signal) return
    fail(createAbortError(signal), true)
  }

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true })
    abortListenerAttached = true
    if (signal.aborted) {
      onAbort()
    }
  }

  try {
    const responseHandle = await StreamHttp.addListener('response', (data) => routeEvent({ type: 'response', data }))
    responseRemover = responseHandle.remove
    retainListener(responseRemover)

    const chunkHandle = await StreamHttp.addListener('chunk', (data) => routeEvent({ type: 'chunk', data }))
    retainListener(chunkHandle.remove)

    const endHandle = await StreamHttp.addListener('end', (data) => routeEvent({ type: 'end', data }))
    retainListener(endHandle.remove)

    const errorHandle = await StreamHttp.addListener('error', (data) => routeEvent({ type: 'error', data }))
    retainListener(errorHandle.remove)

    if (finished) {
      throw terminalError ?? new Error('Native stream stopped before it could start.')
    }

    const result = await StreamHttp.startStream(options)
    streamId = result.id
    for (const event of pendingEvents.splice(0)) {
      routeEvent(event)
    }

    if (cancelRequested) {
      await cancelNative()
    }
    if (terminalError) {
      throw terminalError
    }

    const metadata = await metadataPromise
    return { stream, ...metadata }
  } catch (cause) {
    const error = terminalError ?? asError(cause, 'Failed to start native stream')
    if (!finished) {
      fail(error, streamId !== null)
    } else if (cancelRequested) {
      await cancelNative()
    }
    throw error
  }
}
