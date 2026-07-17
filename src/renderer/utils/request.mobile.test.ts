import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  handleMobileRequest: vi.fn(),
}))

vi.mock('@/platform', () => ({
  default: { type: 'mobile', getVersion: vi.fn(async () => '0.0.1') },
}))

vi.mock('./mobile-request', () => ({
  handleMobileRequest: testState.handleMobileRequest,
}))

import { apiRequest } from './request'

describe('mobile API routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    testState.handleMobileRequest.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  it('routes both proxy and non-proxy provider calls through native HTTP', async () => {
    await apiRequest.get('https://one.example/v1/models', { Authorization: 'Bearer one' }, { useProxy: false })
    await apiRequest.post(
      'https://two.example/v1/responses',
      { Authorization: 'Bearer two' },
      JSON.stringify({ model: 'test' }),
      { useProxy: true }
    )

    expect(testState.handleMobileRequest).toHaveBeenCalledTimes(2)
    expect(testState.handleMobileRequest.mock.calls[0]?.[0]).toBe('https://one.example/v1/models')
    expect(testState.handleMobileRequest.mock.calls[1]?.[0]).toBe('https://two.example/v1/responses')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not retry an aborted native request', async () => {
    testState.handleMobileRequest.mockRejectedValue(new DOMException('cancelled', 'AbortError'))

    await expect(apiRequest.get('https://one.example/v1/models', {}, { retry: 3 })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(testState.handleMobileRequest).toHaveBeenCalledOnce()
  })

  it('does not automatically replay a POST after a network failure', async () => {
    testState.handleMobileRequest.mockRejectedValue(new Error('connection reset'))

    await expect(
      apiRequest.post(
        'https://one.example/v1/responses',
        {},
        JSON.stringify({ model: 'billable-model', input: 'hello' })
      )
    ).rejects.toThrow('Network Error: connection reset')
    expect(testState.handleMobileRequest).toHaveBeenCalledOnce()
  })
})
