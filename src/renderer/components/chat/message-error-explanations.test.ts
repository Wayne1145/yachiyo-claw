import { describe, expect, it } from 'vitest'
import { explainRequestError, parseHttpStatus } from './message-error-explanations'

describe('message error explanations', () => {
  it('explains common HTTP and provider errors locally', () => {
    expect(explainRequestError('API Error', '', 401)).toContain('API 密钥')
    expect(explainRequestError('API Error', 'insufficient_quota')).toContain('余额')
    expect(explainRequestError('API Error', 'model does not exist')).toContain('模型')
    expect(explainRequestError('local_inference_process_crashed')).toContain('推理进程')
  })

  it('parses status metadata and common error strings', () => {
    expect(parseHttpStatus('API Error: Status Code 503')).toBe(503)
    expect(parseHttpStatus('HTTP 429', '401')).toBe(401)
    expect(parseHttpStatus('unclassified')).toBeUndefined()
  })
})
