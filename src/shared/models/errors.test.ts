import { describe, expect, it } from 'vitest'
import {
  AIProviderNoImplementedChatError,
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  NetworkError,
  OCRError,
} from './errors'

describe('BaseError', () => {
  it('sets message and default code', () => {
    const error = new BaseError('base failure')

    expect(error.message).toBe('base failure')
    expect(error.code).toBe(1)
  })
})

describe('ApiError', () => {
  it('sets code, prefixes message, and stores responseBody', () => {
    const error = new ApiError('bad request', '{"error":"bad"}', 400, 'req-123')

    expect(error.code).toBe(10001)
    expect(error.message).toBe('API Error: bad request')
    expect(error.responseBody).toBe('{"error":"bad"}')
    expect(error.statusCode).toBe(400)
    expect(error.requestId).toBe('req-123')
  })

  it('keeps responseBody undefined when not provided', () => {
    const error = new ApiError('missing payload')

    expect(error.code).toBe(10001)
    expect(error.message).toBe('API Error: missing payload')
    expect(error.responseBody).toBeUndefined()
  })
})

describe('NetworkError', () => {
  it('sets code, prefixes message, and stores host', () => {
    const error = new NetworkError('connection timeout', 'api.example.com')

    expect(error.code).toBe(10002)
    expect(error.message).toBe('Network Error: connection timeout')
    expect(error.host).toBe('api.example.com')
  })
})

describe('AIProviderNoImplementedPaintError', () => {
  it('sets code and includes provider name in message', () => {
    const error = new AIProviderNoImplementedPaintError('OpenAI')

    expect(error.code).toBe(10003)
    expect(error.message).toContain('OpenAI')
    expect(error.message).toBe('Current AI Provider OpenAI Does Not Support Painting')
  })
})

describe('AIProviderNoImplementedChatError', () => {
  it('sets code and includes provider name in message', () => {
    const error = new AIProviderNoImplementedChatError('OpenAI')

    expect(error.code).toBe(10005)
    expect(error.message).toContain('OpenAI')
    expect(error.message).toBe('Current AI Provider OpenAI Does Not Support Chat Completions API')
  })
})

describe('OCRError', () => {
  it('sets code, stores ocrProvider and cause error', () => {
    const cause = new Error('OCR engine crashed')
    const error = new OCRError('tesseract', cause)

    expect(error.code).toBe(10006)
    expect(error.ocrProvider).toBe('tesseract')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('OCR Error (tesseract): OCR engine crashed')
  })
})

describe('ChatboxAIAPIError', () => {
  it('constructor sets detail and code from detail', () => {
    const detail = {
      name: 'custom_error',
      code: 29999,
      i18nKey: 'custom.i18n.key',
    }
    const error = new ChatboxAIAPIError('service failed', detail, 'req-123')

    expect(error.message).toBe('service failed')
    expect(error.detail).toEqual(detail)
    expect(error.code).toBe(29999)
    expect(error.requestId).toBe('req-123')
  })

  it('fromCodeName returns ChatboxAIAPIError for known codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('quota exceeded', 'token_quota_exhausted', 'req-123')

    expect(error).toBeInstanceOf(ChatboxAIAPIError)
    expect(error?.message).toBe('quota exceeded')
    expect(error?.code).toBe(10004)
    expect(error?.detail.name).toBe('token_quota_exhausted')
    expect(error?.requestId).toBe('req-123')
  })

  it('fromCodeName returns null for unknown codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('failed', 'not_a_real_codename')

    expect(error).toBeNull()
  })

  it('fromCodeName returns null for empty codename', () => {
    const error = ChatboxAIAPIError.fromCodeName('failed', '')

    expect(error).toBeNull()
  })

  it('getDetail returns detail for known code', () => {
    const detail = ChatboxAIAPIError.getDetail(10004)

    expect(detail).not.toBeNull()
    expect(detail?.name).toBe('token_quota_exhausted')
    expect(detail?.code).toBe(10004)
    expect(typeof detail?.i18nKey).toBe('string')
  })

  it('getDetail returns null for unknown code', () => {
    const detail = ChatboxAIAPIError.getDetail(99999)

    expect(detail).toBeNull()
  })

  it('getDetail returns null for 0 or falsy code', () => {
    expect(ChatboxAIAPIError.getDetail(0)).toBeNull()
    expect(ChatboxAIAPIError.getDetail(Number.NaN)).toBeNull()
  })
})

describe('Error inheritance', () => {
  it('all exported errors are instanceof Error and BaseError', () => {
    const chatboxDetail = ChatboxAIAPIError.getDetail(10004)
    expect(chatboxDetail).not.toBeNull()

    const errors = [
      new BaseError('base'),
      new ApiError('api'),
      new NetworkError('network', 'example.com'),
      new AIProviderNoImplementedPaintError('ProviderA'),
      new AIProviderNoImplementedChatError('ProviderB'),
      new OCRError('ocr-provider', new Error('ocr failed')),
      new ChatboxAIAPIError('chatbox', chatboxDetail!),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BaseError)
    }
  })
})
