/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/queryClient', () => {
  const mockClient = {
    setQueryDefaults: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  }
  return { default: mockClient, queryClient: mockClient }
})

import type { Session } from '@shared/types'
import { computationQueue } from '@/packages/token-estimation/computation-queue'
import { useContextTokens } from './context-tokens'

function createSessionWithoutTokenCache(): Session {
  return {
    id: 'test-session',
    name: 'Test',
    messages: [
      { id: 'msg-1', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: 'msg-2', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] },
    ],
    compactionPoints: [],
    settings: {},
  } as Session
}

let testQueryClient: QueryClient

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: testQueryClient }, children)
}

describe('context-tokens integration tests', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    computationQueue._reset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    computationQueue._reset()
    vi.restoreAllMocks()
  })

  it('no recalculation on re-render when deps unchanged', () => {
    const enqueueSpy = vi.spyOn(computationQueue, 'enqueueBatch')
    const session = createSessionWithoutTokenCache()

    const { rerender } = renderHook(
      () =>
        useContextTokens({
          sessionId: 'test-session',
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
        }),
      { wrapper: createWrapper() }
    )

    const initialCallCount = enqueueSpy.mock.calls.length

    rerender()

    expect(enqueueSpy.mock.calls.length).toBe(initialCallCount)
  })
})
