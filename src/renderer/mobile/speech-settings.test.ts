import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SPEECH_SETTINGS,
  getSpeechProviderDefaults,
  getSpeechSettings,
  parseSpeechHeaders,
  resolveSpeechEndpoint,
} from './speech-settings'

describe('speech provider settings', () => {
  it('uses the bundled offline engine by default and migrates the old misleading value', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    expect(DEFAULT_SPEECH_SETTINGS.asrProvider).toBe('yachiyo-offline')
    localStorage.setItem('yachiyo.speech.settings.v2', JSON.stringify({ asrProvider: 'android-local' }))
    expect(getSpeechSettings().asrProvider).toBe('yachiyo-offline')
    localStorage.removeItem('yachiyo.speech.settings.v2')
  })
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
