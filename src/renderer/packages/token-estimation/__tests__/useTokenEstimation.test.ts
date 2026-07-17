/**
 * @vitest-environment jsdom
 */
import type { Message } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computationQueue } from '../computation-queue'
import { useTokenEstimation } from '../hooks/useTokenEstimation'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  }
}

describe('useTokenEstimation', () => {
  beforeEach(() => {
    computationQueue._reset()
  })

  afterEach(() => {
    computationQueue._reset()
  })

  describe('basic functionality', () => {
    it('returns zero values when no messages provided', () => {
      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(result.current.currentInputTokens).toBe(0)
      expect(result.current.contextTokens).toBe(0)
      expect(result.current.totalTokens).toBe(0)
      expect(result.current.isCalculating).toBe(false)
      expect(result.current.pendingTasks).toBe(0)
    })

    it('calculates current input tokens inline (ignores cache)', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (calculated inline, cache ignored)
      expect(result.current.currentInputTokens).toBe(2)
      expect(result.current.totalTokens).toBe(2)
    })

    it('calculates totalTokens as sum of currentInput and context', () => {
      const currentInput = createMessage({
        id: 'current',
        tokenCountMap: { default: 50 },
        tokenCalculatedAt: { default: 1000 },
      })
      const contextMsg = createMessage({
        id: 'context',
        tokenCountMap: { default: 150 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: currentInput,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // currentInput: 2 (inline), context: 150 (cached)
      expect(result.current.currentInputTokens).toBe(2)
      expect(result.current.contextTokens).toBe(150)
      expect(result.current.totalTokens).toBe(152)
    })

    it('returns breakdown of token sources', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (calculated inline)
      expect(result.current.breakdown).toEqual({
        currentInput: { text: 2, attachments: 0 },
        context: { text: 0, attachments: 0 },
      })
    })
  })

  describe('tokenizer type selection', () => {
    it('uses default tokenizer for current input calculation', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (default tiktoken)
      expect(result.current.currentInputTokens).toBe(2)
    })

    it('uses deepseek tokenizer for current input when model is deepseek', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: { provider: 'deepseek', modelId: 'deepseek-chat' },
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 7 tokens (deepseek)
      expect(result.current.currentInputTokens).toBe(7)
    })
  })

  describe('task submission', () => {
    it('does not submit tasks for current input text (calculated inline)', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // No tasks submitted because current input text is calculated inline
      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('submits tasks for context messages without cache', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(1)
      const tasks = computationQueue.getPendingTasks()
      expect(tasks[0]).toMatchObject({
        sessionId: 'session-1',
        messageId: 'ctx-no-cache',
      })
    })

    it('does not submit tasks when sessionId is null', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: null,
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('does not submit tasks when sessionId is "new"', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'new',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('does not submit tasks when all tokens are cached', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })
  })

  describe('queue status subscription', () => {
    it('updates isCalculating when queue status changes', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })
      const contextMsg = createMessage({
        id: 'ctx-msg',
        tokenCountMap: { default: 50 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(result.current.isCalculating).toBe(false)

      act(() => {
        computationQueue.enqueue({
          type: 'message-text',
          sessionId: 'session-1',
          messageId: 'ctx-msg',
          tokenizerType: 'default',
          priority: 10,
        })
      })

      expect(result.current.isCalculating).toBe(true)
      expect(result.current.pendingTasks).toBe(1)
    })
  })

  describe('session change cleanup', () => {
    it('cancels tasks when session changes', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      const { rerender } = renderHook(
        ({ sessionId }) =>
          useTokenEstimation({
            sessionId,
            constructedMessage: undefined,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { sessionId: 'session-1' } }
      )

      expect(computationQueue.getStatus().pending).toBe(1)

      rerender({ sessionId: 'session-2' })

      const tasks = computationQueue.getPendingTasks()
      const session1Tasks = tasks.filter((t) => t.sessionId === 'session-1')
      expect(session1Tasks).toHaveLength(0)
    })

    it('removes pending tasks when sessionId changes to null', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      const { rerender } = renderHook(
        ({ sessionId }) =>
          useTokenEstimation({
            sessionId,
            constructedMessage: undefined,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { sessionId: 'session-1' as string | null } }
      )

      expect(computationQueue.getStatus().pending).toBe(1)
      expect(computationQueue.getPendingTasks()[0].sessionId).toBe('session-1')

      rerender({ sessionId: null })

      const session1Tasks = computationQueue.getPendingTasks().filter((t) => t.sessionId === 'session-1')
      expect(session1Tasks).toHaveLength(0)
    })
  })

  describe('memoization', () => {
    it('does not resubmit tasks when same props are passed', () => {
      const message = createMessage({
        id: 'msg-cached',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })
      const enqueueSpy = vi.spyOn(computationQueue, 'enqueueBatch')

      const { rerender } = renderHook(
        ({ constructedMessage }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage,
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { constructedMessage: message } }
      )

      const initialCallCount = enqueueSpy.mock.calls.length

      rerender({ constructedMessage: message })

      expect(enqueueSpy.mock.calls.length).toBe(initialCallCount)

      enqueueSpy.mockRestore()
    })

    it('reanalyzes when messages change', () => {
      const message1 = createMessage({
        id: 'msg-1',
        contentParts: [{ type: 'text', text: 'Hello' }],
      })
      const message2 = createMessage({
        id: 'msg-2',
        contentParts: [{ type: 'text', text: 'Hello world, how are you doing today?' }],
      })

      const { result, rerender } = renderHook(
        ({ constructedMessage }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage,
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { constructedMessage: message1 } }
      )

      const firstTokens = result.current.currentInputTokens

      rerender({ constructedMessage: message2 })

      // Different message content should result in different token count
      expect(result.current.currentInputTokens).not.toBe(firstTokens)
    })
  })
})
