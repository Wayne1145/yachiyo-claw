import { Capacitor } from '@capacitor/core'
import {
  decryptMobileProtectedValue,
  encryptMobileProtectedValue,
  isYachiyoSecureStorageEnvelope,
} from '@/platform/native/yachiyo_secure_storage'

export interface SpeechCredentials {
  asrApiKey: string
  ttsApiKey: string
}

const STORAGE_KEY = 'yachiyo.speech.credentials.v1'
const EMPTY_CREDENTIALS: SpeechCredentials = { asrApiKey: '', ttsApiKey: '' }

export async function getSpeechCredentials(): Promise<SpeechCredentials> {
  if (typeof localStorage === 'undefined') return EMPTY_CREDENTIALS
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return EMPTY_CREDENTIALS
  try {
    const plaintext = isYachiyoSecureStorageEnvelope(stored)
      ? await decryptMobileProtectedValue(stored)
      : Capacitor.isNativePlatform()
        ? ''
        : stored
    return { ...EMPTY_CREDENTIALS, ...(JSON.parse(plaintext || '{}') as Partial<SpeechCredentials>) }
  } catch {
    return EMPTY_CREDENTIALS
  }
}

export async function saveSpeechCredentials(credentials: SpeechCredentials): Promise<void> {
  const plaintext = JSON.stringify(credentials)
  const stored = Capacitor.isNativePlatform() ? await encryptMobileProtectedValue(plaintext) : plaintext
  localStorage.setItem(STORAGE_KEY, stored)
}
