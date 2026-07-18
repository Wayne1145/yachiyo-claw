import { describe, expect, it } from 'vitest'
import { getSpeechProviderDefaults, parseSpeechHeaders, resolveSpeechEndpoint } from './speech-settings'

describe('speech provider settings', () => {
  it('builds compatible endpoints without duplicating a full endpoint', () => {
    expect(resolveSpeechEndpoint('https://example.com/v1', '/audio/speech')).toBe(
      'https://example.com/v1/audio/speech'
    )
    expect(resolveSpeechEndpoint('https://example.com/v1/audio/speech', '/audio/speech')).toBe(
      'https://example.com/v1/audio/speech'
    )
  })

  it('provides templates and validates custom headers', () => {
    expect(getSpeechProviderDefaults('aliyun', 'tts').baseUrl).toContain('aliyuncs.com')
    expect(parseSpeechHeaders('{"X-App-Id":"demo"}')).toEqual({ 'X-App-Id': 'demo' })
    expect(() => parseSpeechHeaders('[]')).toThrow('speech_headers_invalid')
  })
})
