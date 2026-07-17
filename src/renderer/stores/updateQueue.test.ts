import { describe, expect, test, vi } from 'vitest'
import { UpdateQueue } from './updateQueue'

type State = { value: number }

describe('UpdateQueue concurrency', () => {
  test('processes concurrent updates sequentially', async () => {
    const onChange = vi.fn()
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    const seen: Array<number | undefined> = []
    const updates = Array.from({ length: 3 }, () =>
      vi.fn((prev: State | null | undefined) => {
        seen.push(prev?.value)
        return { value: (prev?.value ?? 0) + 1 }
      })
    )
    const results = await Promise.all(updates.map((update) => queue.set(update)))

    expect(results).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }])
    expect(seen).toEqual([0, 1, 2])
    updates.forEach((update) => expect(update).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 3 })
  })

  test('does not lose updates enqueued during flush', async () => {
    const queue = new UpdateQueue<State>({ value: 0 })

    let innerPromise: Promise<State> | undefined
    const outerPromise = queue.set((prev) => {
      innerPromise = queue.set((innerPrev) => ({ value: (innerPrev?.value ?? 0) + 1 }))
      return { value: (prev?.value ?? 0) + 1 }
    })

    await expect(outerPromise).resolves.toEqual({ value: 1 })
    expect(innerPromise).toBeDefined()
    await expect(innerPromise!).resolves.toEqual({ value: 2 })
  })

  test('initializes from async loader once for concurrent requests', async () => {
    const initialLoader = vi.fn(async () => {
      await Promise.resolve()
      return { value: 5 }
    })
    const queue = new UpdateQueue<State>(initialLoader)

    const results = await Promise.all([
      queue.set((prev) => ({ value: (prev?.value ?? 0) + 2 })),
      queue.set((prev) => ({ value: (prev?.value ?? 0) * 2 })),
    ])

    expect(results).toEqual([{ value: 7 }, { value: 14 }])
    expect(initialLoader).toHaveBeenCalledTimes(1)
  })

  test('continues processing after updater throws', async () => {
    const onChange = vi.fn()
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)
    const error = new Error('boom')

    const first = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))
    const failing = queue.set(() => {
      throw error
    })
    const third = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))

    await expect(first).resolves.toEqual({ value: 1 })
    await expect(failing).rejects.toThrow(error)
    await expect(third).resolves.toEqual({ value: 2 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 2 })
  })
})

describe('UpdateQueue async onChange handler', () => {
  test('waits for async onChange to resolve before settling promises', async () => {
    const resolveOrder: string[] = []
    const onChange = vi.fn(async (_state: State | null) => {
      resolveOrder.push('onChange-start')
      await new Promise((resolve) => setTimeout(resolve, 50))
      resolveOrder.push('onChange-end')
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    const promise = queue.set((prev) => {
      resolveOrder.push('updater')
      return { value: (prev?.value ?? 0) + 1 }
    })

    void promise.then(() => resolveOrder.push('promise-resolved'))

    const result = await promise
    expect(result).toEqual({ value: 1 })
    expect(resolveOrder).toEqual(['updater', 'onChange-start', 'onChange-end', 'promise-resolved'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 1 })
  })

  test('waits for async onChange with multiple concurrent updates', async () => {
    const onChange = vi.fn(async (_state: State | null) => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    const results = await Promise.all([
      queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 })),
      queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 })),
      queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 })),
    ])

    expect(results).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }])
    // onChange should be called only once for the batch
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 3 })
  })

  test('rejects all updates if async onChange fails', async () => {
    const error = new Error('onChange failed')
    const onChange = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      throw error
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    const first = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))
    const second = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))

    await expect(first).rejects.toThrow(error)
    await expect(second).rejects.toThrow(error)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  test('handles mix of successful and failed updaters with async onChange', async () => {
    const onChange = vi.fn(async (_state: State | null) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)
    const error = new Error('updater failed')

    const first = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))
    const failing = queue.set(() => {
      throw error
    })
    const third = queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))

    await expect(first).resolves.toEqual({ value: 1 })
    await expect(failing).rejects.toThrow(error)
    await expect(third).resolves.toEqual({ value: 2 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 2 })
  })

  test('works with synchronous onChange handler', async () => {
    const onChange = vi.fn((_state: State | null) => {
      // synchronous onChange, should work as before
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    const result = await queue.set((prev) => ({ value: (prev?.value ?? 0) + 1 }))

    expect(result).toEqual({ value: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ value: 1 })
  })

  test('does not call onChange when state does not change', async () => {
    const onChange = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const queue = new UpdateQueue<State>({ value: 5 }, onChange)

    const result = await queue.set((prev) => prev ?? { value: 5 })

    expect(result).toEqual({ value: 5 })
    expect(onChange).not.toHaveBeenCalled()
  })

  test('ensures async onChange completes before next flush', async () => {
    const executionOrder: string[] = []
    const delays = [100, 0]
    let i = 0
    const onChange = vi.fn(async () => {
      executionOrder.push('onChange-1-start')
      await new Promise((resolve) => setTimeout(resolve, delays[i++]))
      executionOrder.push('onChange-1-end')
    })
    const queue = new UpdateQueue<State>({ value: 0 }, onChange)

    // First batch
    const firstBatch = queue.set((prev) => {
      executionOrder.push('update-1')
      return { value: (prev?.value ?? 0) + 1 }
    })

    await firstBatch

    // Second batch - should start after first onChange completes
    const secondBatch = queue.set((prev) => {
      executionOrder.push('update-2')
      return { value: (prev?.value ?? 0) + 1 }
    })

    await secondBatch

    expect(executionOrder).toEqual([
      'update-1',
      'onChange-1-start',
      'onChange-1-end',
      'update-2',
      'onChange-1-start',
      'onChange-1-end',
    ])
    // expect(onChange).toHaveBeenCalledTimes(1)
  })
})
