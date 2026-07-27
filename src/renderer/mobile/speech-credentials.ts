import { Capacitor } from '@capacitor/core'
import {
  decryptMobileProtectedValue,
  encryptMobileProtectedValue,
  isYachiyoSecureStorageEnvelope,
  yachiyoSecureStorageEnvelopeVersion,
} from '@/platform/native/yachiyo_secure_storage'

export interface SpeechCredentials {
  asrApiKey: string
  ttsApiKey: string
  asrHeaders: string
  ttsHeaders: string
}

const STORAGE_KEY = 'yachiyo.speech.credentials.v1'
const PROTECTION_CONTEXT = 'speech/credentials/v1'
const EMPTY_CREDENTIALS: SpeechCredentials = { asrApiKey: '', ttsApiKey: '', asrHeaders: '', ttsHeaders: '' }

export async function getSpeechCredentials(): Promise<SpeechCredentials> {
  if (typeof localStorage === 'undefined') return EMPTY_CREDENTIALS
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return EMPTY_CREDENTIALS
  try {
    const encrypted = isYachiyoSecureStorageEnvelope(stored)
    const plaintext = encrypted
      ? await decryptMobileProtectedValue(stored, PROTECTION_CONTEXT, { allowLegacyContextless: true })
      : Capacitor.isNativePlatform()
        ? ''
        : stored
    const credentials = { ...EMPTY_CREDENTIALS, ...(JSON.parse(plaintext || '{}') as Partial<SpeechCredentials>) }
    if (Capacitor.isNativePlatform() && encrypted && yachiyoSecureStorageEnvelopeVersion(stored) === 1) {
      localStorage.setItem(STORAGE_KEY, await encryptMobileProtectedValue(JSON.stringify(credentials), PROTECTION_CONTEXT))
    }
    return credentials
  } catch {
    return EMPTY_CREDENTIALS
  }
}

export async function saveSpeechCredentials(credentials: SpeechCredentials): Promise<void> {
  const plaintext = JSON.stringify(credentials)
  const stored = Capacitor.isNativePlatform()
    ? await encryptMobileProtectedValue(plaintext, PROTECTION_CONTEXT)
    : plaintext
  localStorage.setItem(STORAGE_KEY, stored)
}
