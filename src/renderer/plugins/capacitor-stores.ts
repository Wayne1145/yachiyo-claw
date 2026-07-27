import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import localforage from 'localforage'
import {
  parseInstalledPluginRecord,
  type InstalledPluginRecord,
  type PluginFileStore,
  type PluginRegistryStore,
} from './installer'
import { PluginGrantSchema, type PluginGrant } from '@shared/plugins/grants'
import {
  decryptMobileProtectedValue,
  encryptMobileProtectedValue,
  isYachiyoSecureStorageEnvelope,
  yachiyoSecureStorageEnvelopeVersion,
} from '@/platform/native/yachiyo_secure_storage'

/**
 * Capacitor-backed implementations of the installer seams (platform-27/28).
 *
 * - Files live under Directory.Data (app-private, no external-storage permission surface).
 *   `Filesystem.rename` on Android maps to `File.renameTo` within the same volume — atomic there.
 * - Registry metadata lives in IndexedDB. On Android, every grant value is encrypted by the Android
 *   Keystore before its envelope is persisted; a crypto failure fails closed rather than writing
 *   plaintext authorization state. Grants are never exposed through the worker host API.
 */

const PLUGIN_ROOT = 'yachiyo-plugin-data'

function grantProtectionContext(pluginId: string, capability: string): string {
  return `plugin-grant/v2/${encodeURIComponent(pluginId)}/${encodeURIComponent(capability)}`
}

function dataProtectionContext(storageKey: string): string {
  return `plugin-data/v2/${encodeURIComponent(storageKey)}`
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function ensureParentDir(path: string): Promise<void> {
  const parent = path.slice(0, path.lastIndexOf('/'))
  if (!parent) return
  try {
    await Filesystem.mkdir({ path: parent, directory: Directory.Data, recursive: true })
  } catch {
    // Already exists.
  }
}

export const capacitorPluginFileStore: PluginFileStore = {
  async writeFile(path, bytes) {
    const fullPath = `${PLUGIN_ROOT}/${path}`
    await ensureParentDir(fullPath)
    await Filesystem.writeFile({ path: fullPath, directory: Directory.Data, data: base64FromBytes(bytes) })
  },
  async readFile(path) {
    const result = await Filesystem.readFile({ path: `${PLUGIN_ROOT}/${path}`, directory: Directory.Data })
    if (typeof result.data !== 'string') throw new Error('Unexpected file payload')
    return bytesFromBase64(result.data)
  },
  async rename(from, to) {
    // Replace-on-rename: drop any existing target first so renameTo cannot fail on a non-empty dir.
    try {
      await Filesystem.rmdir({ path: `${PLUGIN_ROOT}/${to}`, directory: Directory.Data, recursive: true })
    } catch {
      // Target did not exist.
    }
    await ensureParentDir(`${PLUGIN_ROOT}/${to}`)
    await Filesystem.rename({ from: `${PLUGIN_ROOT}/${from}`, to: `${PLUGIN_ROOT}/${to}`, directory: Directory.Data })
  },
  async removeDir(path) {
    try {
      await Filesystem.rmdir({ path: `${PLUGIN_ROOT}/${path}`, directory: Directory.Data, recursive: true })
    } catch {
      // Best-effort: absent is fine.
    }
  },
  async exists(path) {
    try {
      await Filesystem.stat({ path: `${PLUGIN_ROOT}/${path}`, directory: Directory.Data })
      return true
    } catch {
      return false
    }
  },
  async listDirectories(path) {
    try {
      const result = await Filesystem.readdir({ path: `${PLUGIN_ROOT}/${path}`, directory: Directory.Data })
      return result.files.filter((entry) => entry.type === 'directory').map((entry) => entry.name)
    } catch {
      return []
    }
  },
}

const registryStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'plugin-registry' })
const grantStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'plugin-grants' })
const dataStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'plugin-data' })
const healthStorage = localforage.createInstance({ name: 'yachiyo-claw', storeName: 'plugin-health' })

export const localforagePluginRegistry: PluginRegistryStore = {
  async get(pluginId) {
    const stored = await registryStorage.getItem<unknown>(pluginId)
    if (stored === null) return null
    try {
      return parseInstalledPluginRecord(stored, pluginId)
    } catch {
      await registryStorage.removeItem(pluginId).catch(() => {})
      return null
    }
  },
  async put(record) {
    const validated = parseInstalledPluginRecord(record, record.manifest.id)
    await registryStorage.setItem(validated.manifest.id, validated)
  },
  async remove(pluginId) {
    await registryStorage.removeItem(pluginId)
  },
  async list() {
    return listInstalledPlugins()
  },
}

export async function listInstalledPlugins(): Promise<InstalledPluginRecord[]> {
  const records: InstalledPluginRecord[] = []
  const invalidKeys: string[] = []
  await registryStorage.iterate<unknown, void>((record, key) => {
    try {
      records.push(parseInstalledPluginRecord(record))
    } catch {
      // Invalid registry rows are invisible and cannot influence code paths.
      invalidKeys.push(key)
    }
  })
  await Promise.all(invalidKeys.map((key) => registryStorage.removeItem(key)))
  return records.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
}

/** Grant persistence (plat-23). Keyed `<pluginId>:<capability>`. Never exposed via the host API. */
export const pluginGrantStore = {
  async get(pluginId: string, capability: string): Promise<PluginGrant | null> {
    const key = `${pluginId}:${capability}`
    const stored = await grantStorage.getItem<unknown>(key)
    if (stored === null) return null
    try {
      const parseBoundGrant = (value: unknown) => {
        const grant = PluginGrantSchema.parse(value)
        if (grant.pluginId !== pluginId || grant.capability !== capability) throw new Error('grant_key_mismatch')
        return grant
      }
      if (Capacitor.isNativePlatform()) {
        if (typeof stored === 'string' && isYachiyoSecureStorageEnvelope(stored)) {
          const legacy = yachiyoSecureStorageEnvelopeVersion(stored) === 1
          const parsed = parseBoundGrant(
            JSON.parse(
              await decryptMobileProtectedValue(stored, grantProtectionContext(pluginId, capability), {
                allowLegacyContextless: legacy,
              })
            )
          )
          if (legacy) await this.put(parsed)
          return parsed
        }
        // One-time migration for pre-Keystore builds. Parsing happens before rewriting.
        const legacy = parseBoundGrant(stored)
        await this.put(legacy)
        return legacy
      }
      return parseBoundGrant(stored)
    } catch {
      // Corrupt, undecryptable, or downgraded data is unauthorized.
      await grantStorage.removeItem(key).catch(() => {})
      return null
    }
  },
  async put(grant: PluginGrant): Promise<void> {
    const validated = PluginGrantSchema.parse(grant)
    const value: PluginGrant | string = Capacitor.isNativePlatform()
      ? await encryptMobileProtectedValue(
          JSON.stringify(validated),
          grantProtectionContext(validated.pluginId, validated.capability)
        )
      : validated
    await grantStorage.setItem(`${grant.pluginId}:${grant.capability}`, value)
  },
  async remove(pluginId: string, capability: string): Promise<void> {
    await grantStorage.removeItem(`${pluginId}:${capability}`)
  },
  async removeAll(pluginId: string): Promise<void> {
    const keys = await grantStorage.keys()
    await Promise.all(keys.filter((key) => key.startsWith(`${pluginId}:`)).map((key) => grantStorage.removeItem(key)))
  },
}

/** Namespaced plugin key-value data (plat-28), used by the `storage` host API. */
export const pluginDataStore = {
  async get(storageKey: string): Promise<string | null> {
    const stored = await dataStorage.getItem<unknown>(storageKey)
    if (stored === null) return null
    if (!Capacitor.isNativePlatform()) return typeof stored === 'string' ? stored : null
    try {
      if (
        stored &&
        typeof stored === 'object' &&
        ((stored as { schemaVersion?: unknown }).schemaVersion === 1 ||
          (stored as { schemaVersion?: unknown }).schemaVersion === 2) &&
        isYachiyoSecureStorageEnvelope((stored as { envelope?: unknown }).envelope)
      ) {
        const schemaVersion = (stored as { schemaVersion: number }).schemaVersion
        const value = await decryptMobileProtectedValue(
          (stored as { envelope: string }).envelope,
          dataProtectionContext(storageKey),
          { allowLegacyContextless: schemaVersion === 1 }
        )
        if (schemaVersion === 1) await this.set(storageKey, value)
        return value
      }
      if (typeof stored !== 'string') throw new Error('plugin_data_invalid')
      // Encrypt legacy plaintext on first access.
      await this.set(storageKey, stored)
      return stored
    } catch {
      await dataStorage.removeItem(storageKey).catch(() => {})
      return null
    }
  },
  async set(storageKey: string, value: string): Promise<void> {
    const stored = Capacitor.isNativePlatform()
      ? {
          schemaVersion: 2,
          envelope: await encryptMobileProtectedValue(value, dataProtectionContext(storageKey)),
        }
      : value
    await dataStorage.setItem(storageKey, stored)
  },
  async remove(storageKey: string): Promise<void> {
    await dataStorage.removeItem(storageKey)
  },
  async keys(prefix: string): Promise<string[]> {
    return (await dataStorage.keys()).filter((key) => key.startsWith(prefix))
  },
  async usedBytes(prefix: string): Promise<number> {
    let total = 0
    const keys = await dataStorage.keys()
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const value = await pluginDataStore.get(key)
      if (typeof value === 'string') total += new TextEncoder().encode(value).length
    }
    return total
  },
  async removeAll(prefix: string): Promise<void> {
    const keys = await dataStorage.keys()
    await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => dataStorage.removeItem(key)))
  },
}

/** Per-plugin health/failure counters (plat-29). Cleared on uninstall; audit is NOT stored here. */
export const pluginHealthStore = {
  async get(pluginId: string): Promise<import('@shared/plugins/lifecycle').PluginHealth | null> {
    return (await healthStorage.getItem<import('@shared/plugins/lifecycle').PluginHealth>(pluginId)) ?? null
  },
  async put(pluginId: string, health: import('@shared/plugins/lifecycle').PluginHealth): Promise<void> {
    await healthStorage.setItem(pluginId, health)
  },
  async remove(pluginId: string): Promise<void> {
    await healthStorage.removeItem(pluginId)
  },
}
