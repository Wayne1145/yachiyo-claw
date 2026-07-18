export async function nextAgentStreamPart<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout()
          reject(new Error('agent_stream_idle_timeout'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
