import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPersister, resultPersister } from '../result-persister'
import type { TaskResult } from '../types'

vi.mock('@/stores/chatStore', () => ({
  updateMessages: vi.fn().mockResolvedValue({
    id: 'session-1',
    name: 'Test Session',
    messages: [],
  }),
}))

vi.mock('@/stores/queryClient', () => ({
  default: {
    setQueryData: vi.fn(),
  },
}))

vi.mock('@/stores/taskSessionStore', () => ({
  getTaskSession: vi.fn(),
  updateTaskSession: vi.fn(),
  TASK_SESSION_QUERY_KEY: 'task-session',
}))

import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { getTaskSession, updateTaskSession } from '@/stores/taskSessionStore'

const mockSession = { id: 'session-1', name: 'Test Session', messages: [] }
const mockGetTaskSession = vi.mocked(getTaskSession)
const mockUpdateTaskSession = vi.mocked(updateTaskSession)
const mockSetQueryData = vi.mocked(queryClient.setQueryData)

function createMessageTextResult(
  overrides: Partial<NonNullable<TaskResult['result']>> = {}
): NonNullable<TaskResult['result']> {
  return {
    type: 'message-text',
    sessionId: 'session-1',
    messageId: 'msg-1',
    tokenizerType: 'default',
    tokens: 100,
    calculatedAt: Date.now(),
    ...overrides,
  }
}

function createAttachmentResult(
  overrides: Partial<NonNullable<TaskResult['result']>> = {}
): NonNullable<TaskResult['result']> {
  return {
    type: 'attachment',
    sessionId: 'session-1',
    messageId: 'msg-1',
    attachmentId: 'att-1',
    attachmentType: 'file',
    tokenizerType: 'default',
    contentMode: 'full',
    tokens: 200,
    lineCount: 50,
    byteLength: 1024,
    calculatedAt: Date.now(),
    ...overrides,
  }
}

describe('ResultPersister', () => {
  let persister: ResultPersister

  beforeEach(() => {
    persister = new ResultPersister()
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetTaskSession.mockResolvedValue(null)
    mockUpdateTaskSession.mockResolvedValue(null)
  })

  afterEach(() => {
    persister.cancel()
    vi.useRealTimers()
  })

  describe('addResult', () => {
    it('adds message text result to pending updates', async () => {
      persister.addResult(createMessageTextResult())
      // With throttle, first call triggers immediate flush
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('adds attachment result to pending updates', async () => {
      persister.addResult(createAttachmentResult())
      // With throttle, first call triggers immediate flush
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('merges multiple results for same message', async () => {
      persister.addResult(createMessageTextResult({ tokenizerType: 'default', tokens: 100 }))
      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ tokenizerType: 'deepseek', tokens: 150 }))
      // Second result within throttle window should be batched, not flushed yet
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })

    it('keeps separate entries for different messages', async () => {
      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      // Reset mock for second message
      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('merges multiple attachment results for same message', async () => {
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1' }))
      vi.clearAllMocks()
      persister.addResult(createAttachmentResult({ attachmentId: 'att-2' }))
      // Second result within throttle window should be batched, not flushed yet
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })

    it('updates existing attachment in pending updates', async () => {
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1', tokens: 100 }))
      vi.clearAllMocks()
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1', tokens: 200 }))
      // Second result within throttle window should be batched, not flushed yet
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })

    it('handles preview content mode for attachments', async () => {
      persister.addResult(createAttachmentResult({ contentMode: 'preview' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })
  })

  describe('throttle behavior', () => {
    it('flushes immediately on first call', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('batches results within throttle window (1000ms)', async () => {
      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()

      // Add another result within 1000ms - should be batched
      vi.advanceTimersByTime(500)
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      // Don't run timers yet - the scheduled flush should happen at 1000ms
      expect(chatStore.updateMessages).not.toHaveBeenCalled()

      // Advance to complete the throttle window
      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      // Now the batched result should flush
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('flushes after throttle delay (1000ms) if no flush occurred', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      // Add result after throttle window expires
      vi.advanceTimersByTime(1000)
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(2)
    })
  })

  describe('flushNow', () => {
    it('flushes immediately without waiting for debounce', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('clears pending updates after flush', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()
      expect(persister.getPendingCount()).toBe(0)
    })

    it('cancels pending debounce timer', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
    })

    it('handles empty pending updates', async () => {
      await persister.flushNow()
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })

    it('waits for in-progress flush to complete', async () => {
      let resolveUpdate: (() => void) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUpdate = () =>
              resolve(mockSession as ReturnType<typeof chatStore.updateMessages> extends Promise<infer T> ? T : never)
          }) as ReturnType<typeof chatStore.updateMessages>
      )

      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      const firstFlush = persister.flushNow()

      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      const secondFlush = persister.flushNow()

      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      resolveUpdate?.()
      await firstFlush
      await secondFlush

      expect(chatStore.updateMessages).toHaveBeenCalledTimes(2)
    })
  })

  describe('cancel', () => {
    it('clears pending updates', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.cancel()

      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })

    it('cancels pending throttle timer', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      persister.cancel()

      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('notifies listeners after flush', async () => {
      const listener = vi.fn()
      persister.subscribe(listener)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('returns unsubscribe function', async () => {
      const listener = vi.fn()
      const unsubscribe = persister.subscribe(listener)

      unsubscribe()

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(listener).not.toHaveBeenCalled()
    })

    it('handles listener errors gracefully', async () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const normalListener = vi.fn()

      persister.subscribe(errorListener)
      persister.subscribe(normalListener)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(errorListener).toHaveBeenCalled()
      expect(normalListener).toHaveBeenCalled()
    })
  })

  describe('flush behavior', () => {
    it('groups updates by sessionId', async () => {
      persister.addResult(createMessageTextResult({ sessionId: 'session-1', messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ sessionId: 'session-1', messageId: 'msg-2' }))
      persister.addResult(createMessageTextResult({ sessionId: 'session-2', messageId: 'msg-3' }))

      await persister.flushNow()

      expect(chatStore.updateMessages).toHaveBeenCalledTimes(2)
      expect(chatStore.updateMessages).toHaveBeenCalledWith('session-1', expect.any(Function))
      expect(chatStore.updateMessages).toHaveBeenCalledWith('session-2', expect.any(Function))
    })

    it('handles updateMessages errors gracefully', async () => {
      vi.mocked(chatStore.updateMessages).mockRejectedValueOnce(new Error('Update failed'))

      persister.addResult(createMessageTextResult({ sessionId: 'session-1' }))
      persister.addResult(createMessageTextResult({ sessionId: 'session-2' }))

      await persister.flushNow()

      expect(chatStore.updateMessages).toHaveBeenCalledTimes(2)
    })

    it('falls back to task session persistence when chat session update fails', async () => {
      vi.mocked(chatStore.updateMessages).mockRejectedValueOnce(new Error('Chat session not found'))
      mockGetTaskSession.mockResolvedValueOnce({
        id: 'session-1',
        name: 'Task Session',
        workingDirectory: '.',
        messages: [{ id: 'msg-1', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }],
        createdAt: Date.now(),
      })
      mockUpdateTaskSession.mockResolvedValueOnce({
        id: 'session-1',
        name: 'Task Session',
        workingDirectory: '.',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            contentParts: [{ type: 'text', text: 'hello' }],
            tokenCountMap: { default: 100 },
            tokenCalculatedAt: { default: 12345 },
          },
        ],
        createdAt: Date.now(),
      })

      persister.addResult(
        createMessageTextResult({
          sessionId: 'session-1',
          messageId: 'msg-1',
          tokenizerType: 'default',
          tokens: 100,
          calculatedAt: 12345,
        })
      )

      await persister.flushNow()

      expect(mockGetTaskSession).toHaveBeenCalledWith('session-1')
      expect(mockUpdateTaskSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ tokenCountMap: expect.objectContaining({ default: 100 }) }),
          ]),
        })
      )
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ['task-session', 'session-1'],
        expect.objectContaining({ id: 'session-1' })
      )
    })
  })

  describe('update application', () => {
    it('applies message text token updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(
        createMessageTextResult({
          messageId: 'msg-1',
          tokenizerType: 'default',
          tokens: 100,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [{ id: 'msg-1', tokenCountMap: {}, tokenCalculatedAt: {} }]
      const result = capturedUpdater?.(messages)

      expect(result).toEqual([
        {
          id: 'msg-1',
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 12345 },
        },
      ])
    })

    it('applies attachment token updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'att-1',
          attachmentType: 'file',
          tokenizerType: 'default',
          contentMode: 'full',
          tokens: 200,
          lineCount: 50,
          byteLength: 1024,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          files: [{ id: 'att-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ files: unknown[] }>

      expect(result?.[0]?.files?.[0]).toEqual({
        id: 'att-1',
        tokenCountMap: { default: 200 },
        tokenCalculatedAt: { default: 12345 },
        lineCount: 50,
        byteLength: 1024,
      })
    })

    it('applies link attachment updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'link-1',
          attachmentType: 'link',
          tokens: 150,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          links: [{ id: 'link-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ links: unknown[] }>

      expect(result?.[0]?.links?.[0]).toMatchObject({
        id: 'link-1',
        tokenCountMap: { default: 150 },
        tokenCalculatedAt: { default: 12345 },
      })
    })

    it('uses preview cache key for preview content mode', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'att-1',
          attachmentType: 'file',
          tokenizerType: 'deepseek',
          contentMode: 'preview',
          tokens: 50,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          files: [{ id: 'att-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ files: unknown[] }>

      expect(result?.[0]?.files?.[0]).toMatchObject({
        tokenCountMap: { deepseek_preview: 50 },
        tokenCalculatedAt: { deepseek_preview: 12345 },
      })
    })

    it('preserves existing token data when adding new', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(
        createMessageTextResult({
          messageId: 'msg-1',
          tokenizerType: 'deepseek',
          tokens: 150,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 11111 },
        },
      ]
      const result = capturedUpdater?.(messages)

      expect(result).toEqual([
        {
          id: 'msg-1',
          tokenCountMap: { default: 100, deepseek: 150 },
          tokenCalculatedAt: { default: 11111, deepseek: 12345 },
        },
      ])
    })

    it('returns empty array when messages is null', async () => {
      let capturedUpdater: ((messages: unknown[] | null) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[] | null) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      const result = capturedUpdater?.(null)
      expect(result).toEqual([])
    })

    it('leaves unmatched messages unchanged', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      vi.mocked(chatStore.updateMessages).mockImplementation((async (_sessionId, updater) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof chatStore.updateMessages)

      persister.addResult(createMessageTextResult({ messageId: 'msg-1', tokens: 100 }))
      await persister.flushNow()

      const messages = [
        { id: 'msg-1', content: 'hello' },
        { id: 'msg-2', content: 'world' },
      ]
      const result = capturedUpdater?.(messages)

      expect(result?.[1]).toEqual({ id: 'msg-2', content: 'world' })
    })
  })
})

describe('resultPersister singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resultPersister.cancel()
    vi.useRealTimers()
  })

  it('is a ResultPersister instance', () => {
    expect(resultPersister).toBeInstanceOf(ResultPersister)
  })

  it('can be used directly', async () => {
    resultPersister.addResult(createMessageTextResult())
    await vi.runAllTimersAsync()
    expect(chatStore.updateMessages).toHaveBeenCalledTimes(1)
  })
})
