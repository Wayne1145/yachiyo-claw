import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ChatboxAIAPIError } from '../models/errors'
import { createAfetch } from './request'

const platformInfo = {
  type: 'desktop',
  platform: 'darwin',
  os: 'macos',
  version: '1.0.0',
}

describe('createAfetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores request id from Chatbox error body on known Chatbox errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'token_quota_exhausted',
              request_id: 'req-from-body',
            },
          }),
          { status: 429 }
        )
      )
    )

    const afetch = createAfetch(platformInfo)

    await expect(
      afetch(
        'https://api.chatboxai.app/gateway/openai/v1/chat/completions',
        {},
        { parseChatboxRemoteError: true }
      )
    ).rejects.toMatchObject({
      code: 10004,
      requestId: 'req-from-body',
    } satisfies Partial<ChatboxAIAPIError>)
  })

  it('stores request id from response headers on generic API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'not_a_real_code', request_id: 'req-from-body' } }), {
          status: 500,
          headers: { 'x-request-id': 'req-from-header' },
        })
      )
    )

    const afetch = createAfetch(platformInfo)

    await expect(
      afetch(
        'https://api.chatboxai.app/gateway/openai/v1/chat/completions',
        {},
        { parseChatboxRemoteError: true }
      )
    ).rejects.toMatchObject({
      code: 10001,
      statusCode: 500,
      requestId: 'req-from-header',
    } satisfies Partial<ApiError>)
  })
})
