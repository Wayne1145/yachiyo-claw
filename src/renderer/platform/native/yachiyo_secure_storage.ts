import { registerPlugin } from '@capacitor/core'

const ENVELOPE_PREFIX = 'yachiyo-secure-storage:'
const ENVELOPE_VERSION = 1
const ENVELOPE_ALGORITHM = 'AES-256-GCM'

interface SecureStoragePlugin {
  encrypt(options: { plaintext: string; protectionContext?: string }): Promise<{ envelope: string }>
  decrypt(options: {
    envelope: string
    protectionContext?: string
    allowLegacyContextless?: boolean
  }): Promise<{ plaintext: string }>
}

interface SecureStorageEnvelope {
  version: number
  algorithm: string
  iv: string
  ciphertext: string
}

const nativeSecureStorage = registerPlugin<SecureStoragePlugin>('YachiyoSecureStorage')

async function encryptProtectedValue(plaintext: string, protectionContext?: string): Promise<string> {
  const { envelope } = await nativeSecureStorage.encrypt({ plaintext, protectionContext })
  if (!isYachiyoSecureStorageEnvelope(envelope)) {
    throw new Error('Invalid encrypted envelope')
  }
  return envelope
}

async function decryptProtectedValue(
  envelope: string,
  protectionContext?: string,
  allowLegacyContextless = false
): Promise<string> {
  if (!isYachiyoSecureStorageEnvelope(envelope)) {
    throw new Error('Invalid encrypted envelope')
  }

  const { plaintext } = await nativeSecureStorage.decrypt({
    envelope,
    ...(protectionContext ? { protectionContext } : {}),
    ...(allowLegacyContextless ? { allowLegacyContextless: true } : {}),
  })
  if (typeof plaintext !== 'string') {
    throw new Error('Invalid decrypted value')
  }
  return plaintext
}

export function hasYachiyoSecureStoragePrefix(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX)
}

export function isYachiyoSecureStorageEnvelope(value: unknown): value is string {
  if (!hasYachiyoSecureStoragePrefix(value)) return false

  try {
    const envelope = JSON.parse(value.slice(ENVELOPE_PREFIX.length)) as Partial<SecureStorageEnvelope>
    return (
      (envelope.version === ENVELOPE_VERSION || envelope.version === 2) &&
      envelope.algorithm === ENVELOPE_ALGORITHM &&
      typeof envelope.iv === 'string' &&
      envelope.iv.length > 0 &&
      typeof envelope.ciphertext === 'string' &&
      envelope.ciphertext.length > 0
    )
  } catch {
    return false
  }
}

export function yachiyoSecureStorageEnvelopeVersion(value: unknown): number | null {
  if (!hasYachiyoSecureStoragePrefix(value)) return null
  try {
    const envelope = JSON.parse(value.slice(ENVELOPE_PREFIX.length)) as Partial<SecureStorageEnvelope>
    return envelope.version === 1 || envelope.version === 2 ? envelope.version : null
  } catch {
    return null
  }
}

export async function encryptMobileProtectedValue(plaintext: string, protectionContext?: string): Promise<string> {
  try {
    return await encryptProtectedValue(plaintext, protectionContext)
  } catch {
    throw new Error('Unable to encrypt protected mobile data.')
  }
}

export async function decryptMobileProtectedValue(
  envelope: string,
  protectionContext?: string,
  options: { allowLegacyContextless?: boolean } = {}
): Promise<string> {
  try {
    return await decryptProtectedValue(envelope, protectionContext, options.allowLegacyContextless)
  } catch {
    throw new Error('Unable to decrypt protected mobile data.')
  }
}

export async function encryptMobileSettings(plaintext: string): Promise<string> {
  try {
    return await encryptProtectedValue(plaintext)
  } catch {
    throw new Error('Unable to encrypt protected mobile settings.')
  }
}

export async function decryptMobileSettings(envelope: string): Promise<string> {
  if (!isYachiyoSecureStorageEnvelope(envelope)) {
    throw new Error('Protected mobile settings envelope is invalid.')
  }

  try {
    return await decryptProtectedValue(envelope)
  } catch {
    throw new Error('Unable to decrypt protected mobile settings.')
  }
}
