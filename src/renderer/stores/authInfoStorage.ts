import type { StateStorage } from 'zustand/middleware'
import {
  decryptMobileProtectedValue,
  encryptMobileProtectedValue,
  hasYachiyoSecureStoragePrefix,
  isYachiyoSecureStorageEnvelope,
} from '@/platform/native/yachiyo_secure_storage'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from '@/variables'

export const AUTH_INFO_STORAGE_KEY = 'chatbox-ai-auth-info'

const INVALID_AUTH_DATA_ERROR = 'Protected mobile authentication data is invalid.'
const READ_AUTH_DATA_ERROR = 'Unable to read protected mobile authentication data.'
const WRITE_AUTH_DATA_ERROR = 'Unable to protect mobile authentication data.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function assertSerializedAuthInfo(value: string): void {
  let persisted: unknown
  try {
    persisted = JSON.parse(value)
  } catch {
    throw new Error(INVALID_AUTH_DATA_ERROR)
  }

  if (!isRecord(persisted) || !isRecord(persisted.state)) {
    throw new Error(INVALID_AUTH_DATA_ERROR)
  }

  const rootKeys = Object.keys(persisted)
  const stateKeys = Object.keys(persisted.state)
  const hasOnlyExpectedRootKeys = rootKeys.every((key) => key === 'state' || key === 'version')
  const hasOnlyExpectedStateKeys = stateKeys.every((key) => key === 'accessToken' || key === 'refreshToken')
  const hasBothTokens = Object.hasOwn(persisted.state, 'accessToken') && Object.hasOwn(persisted.state, 'refreshToken')
  const hasSupportedVersion =
    persisted.version === undefined ||
    (typeof persisted.version === 'number' && Number.isInteger(persisted.version) && persisted.version >= 0)

  if (
    !hasOnlyExpectedRootKeys ||
    !hasOnlyExpectedStateKeys ||
    !hasBothTokens ||
    !hasSupportedVersion ||
    !isNullableString(persisted.state.accessToken) ||
    !isNullableString(persisted.state.refreshToken)
  ) {
    throw new Error(INVALID_AUTH_DATA_ERROR)
  }
}

async function encryptAuthInfo(value: string): Promise<string> {
  try {
    return await encryptMobileProtectedValue(value)
  } catch {
    throw new Error(WRITE_AUTH_DATA_ERROR)
  }
}

async function writeProtectedAuthInfo(storage: StateStorage, name: string, value: string): Promise<void> {
  const envelope = await encryptAuthInfo(value)
  try {
    await storage.setItem(name, envelope)
  } catch {
    throw new Error(WRITE_AUTH_DATA_ERROR)
  }
}

export function createMobileAuthInfoStateStorage(
  storage: StateStorage = window.localStorage
): StateStorage<Promise<void>> {
  return {
    getItem: async (name) => {
      const storedValue = await storage.getItem(name)
      if (storedValue === null) return null

      if (hasYachiyoSecureStoragePrefix(storedValue)) {
        if (!isYachiyoSecureStorageEnvelope(storedValue)) {
          throw new Error(INVALID_AUTH_DATA_ERROR)
        }

        let plaintext: string
        try {
          plaintext = await decryptMobileProtectedValue(storedValue)
        } catch {
          throw new Error(READ_AUTH_DATA_ERROR)
        }
        assertSerializedAuthInfo(plaintext)
        return plaintext
      }

      // Validate before encryption and replace only after the Keystore operation succeeds.
      assertSerializedAuthInfo(storedValue)
      await writeProtectedAuthInfo(storage, name, storedValue)
      return storedValue
    },
    setItem: async (name, value) => {
      assertSerializedAuthInfo(value)
      await writeProtectedAuthInfo(storage, name, value)
    },
    removeItem: async (name) => {
      await storage.removeItem(name)
    },
  }
}

export function getAuthInfoStateStorage(): StateStorage {
  if (CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'android') {
    return createMobileAuthInfoStateStorage()
  }
  return window.localStorage
}
