/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const secure = vi.hoisted(() => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  version: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@/platform/native/yachiyo_secure_storage', () => ({
  decryptMobileProtectedValue: secure.decrypt,
  encryptMobileProtectedValue: secure.encrypt,
  isYachiyoSecureStorageEnvelope: (value: unknown) => typeof value === 'string' && value.startsWith('secure:'),
  yachiyoSecureStorageEnvelopeVersion: secure.version,
}))

import { getSpeechCredentials, saveSpeechCredentials } from './speech-credentials'

describe('speech credential protection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('migrates a legacy envelope into the speech-bound protection context', async () => {
    localStorage.setItem('yachiyo.speech.credentials.v1', 'secure:legacy')
    secure.version.mockReturnValue(1)
    secure.decrypt.mockResolvedValue('{"asrApiKey":"secret","ttsApiKey":"","asrHeaders":"{\\"X-Key\\":\\"v\\"}"}')
    secure.encrypt.mockResolvedValue('secure:v2')

    const value = await getSpeechCredentials()

    expect(value.asrApiKey).toBe('secret')
    expect(value.asrHeaders).toContain('X-Key')
    expect(secure.decrypt).toHaveBeenCalledWith('secure:legacy', 'speech/credentials/v1', {
      allowLegacyContextless: true,
    })
    expect(secure.encrypt).toHaveBeenCalledWith(expect.stringContaining('secret'), 'speech/credentials/v1')
    expect(localStorage.getItem('yachiyo.speech.credentials.v1')).toBe('secure:v2')
  })

  it('encrypts API keys and custom headers together on Android', async () => {
    secure.encrypt.mockResolvedValue('secure:v2')
    await saveSpeechCredentials({
      asrApiKey: 'asr-secret',
      ttsApiKey: 'tts-secret',
      asrHeaders: '{"Authorization":"Bearer a"}',
      ttsHeaders: '{"X-Token":"b"}',
    })
    expect(secure.encrypt).toHaveBeenCalledWith(expect.stringContaining('Authorization'), 'speech/credentials/v1')
    expect(localStorage.getItem('yachiyo.speech.credentials.v1')).toBe('secure:v2')
  })
})
