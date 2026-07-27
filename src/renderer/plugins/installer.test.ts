import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@shared/skills/skillhub'
import { PluginInstallError } from '@shared/plugins/verify'
import { PLUGIN_STORAGE_LIMITS } from '@shared/plugins/storage'
import {
  type InstalledPluginRecord,
  assertPluginUpdateProvenance,
  PluginInstaller,
  PLUGIN_VERSIONS_DIR,
  type PluginFileStore,
  type PluginRegistryStore,
  parseInstalledPluginRecord,
  pluginInstallDir,
} from './installer'
import { unpackPluginArchive } from './unpack'

const text = (value: string) => new TextEncoder().encode(value)

async function buildZip(
  over: { manifest?: Record<string, unknown>; extraFiles?: Record<string, Uint8Array>; version?: string } = {}
) {
  const entryBytes = text('yachiyo.registerTool("demo_echo", function(a){return a});')
  const entrySha = await sha256Hex(entryBytes)
  const manifest = {
    schemaVersion: 1,
    id: 'demo',
    version: over.version ?? '1.0.0',
    displayName: 'Demo',
    description: 'A demo plugin used by the installer tests.',
    entry: 'main.js',
    entrySha256: entrySha,
    capabilities: [{ name: 'tools', reason: 'Contributes the demo_echo tool to the agent.' }],
    contributions: { tools: [{ name: 'demo_echo', description: 'Echoes its arguments back.' }] },
    files: [{ path: 'main.js', size: entryBytes.byteLength, sha256: entrySha }],
    ...over.manifest,
  }
  const zip = new JSZip()
  zip.file('yachiyo-plugin.json', JSON.stringify(manifest))
  zip.file('main.js', entryBytes)
  for (const [path, bytes] of Object.entries(over.extraFiles ?? {})) zip.file(path, bytes)
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), manifest }
}

class MemoryFileStore implements PluginFileStore {
  files = new Map<string, Uint8Array>()
  failOnWritePath: string | null = null
  failOnRemovePath: string | null = null
  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    if (this.failOnWritePath && path.endsWith(this.failOnWritePath)) throw new Error('disk full')
    this.files.set(path, bytes)
  }
  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path)
    if (!bytes) throw new Error(`missing file: ${path}`)
    return bytes
  }
  async rename(from: string, to: string): Promise<void> {
    // Atomic swap: drop any existing target subtree, then move the staged one over.
    for (const key of [...this.files.keys()]) if (key.startsWith(`${to}/`)) this.files.delete(key)
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${from}/`)) {
        const moved = this.files.get(key) as Uint8Array
        this.files.delete(key)
        this.files.set(`${to}/${key.slice(from.length + 1)}`, moved)
      }
    }
  }
  async removeDir(path: string): Promise<void> {
    if (this.failOnRemovePath === path) throw new Error('directory locked')
    for (const key of [...this.files.keys()]) if (key.startsWith(`${path}/`)) this.files.delete(key)
  }
  async exists(path: string): Promise<boolean> {
    return [...this.files.keys()].some((key) => key.startsWith(`${path}/`))
  }
  async listDirectories(path: string): Promise<string[]> {
    const prefix = `${path}/`
    return [
      ...new Set(
        [...this.files.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length).split('/')[0])
          .filter(Boolean),
      ),
    ].sort()
  }
  paths(): string[] {
    return [...this.files.keys()].sort()
  }
}

class MemoryRegistry implements PluginRegistryStore {
  records = new Map<string, InstalledPluginRecord>()
  failOnPut = false
  async get(pluginId: string): Promise<InstalledPluginRecord | null> {
    return this.records.get(pluginId) ?? null
  }
  async put(record: InstalledPluginRecord): Promise<void> {
    if (this.failOnPut) throw new Error('registry write failed')
    this.records.set(record.manifest.id, record)
  }
  async remove(pluginId: string): Promise<void> {
    this.records.delete(pluginId)
  }
  async list(): Promise<InstalledPluginRecord[]> {
    return [...this.records.values()]
  }
}

function makeInstaller() {
  const fileStore = new MemoryFileStore()
  const registry = new MemoryRegistry()
  return { installer: new PluginInstaller(fileStore, registry), fileStore, registry }
}

describe('plugin update provenance', () => {
  const installed = {
    source: 'marketplace',
    signatureVerified: true,
    signerKeyId: 'publisher-a',
  } as InstalledPluginRecord

  it('rejects source downgrades, unsigned replacements, and publisher changes', () => {
    expect(() =>
      assertPluginUpdateProvenance(installed, {
        source: 'https',
        signatureVerified: true,
        signerKeyId: 'publisher-a',
      })
    ).toThrow('verified marketplace')
    expect(() =>
      assertPluginUpdateProvenance(installed, {
        source: 'marketplace',
        signatureVerified: false,
        signerKeyId: 'publisher-a',
      })
    ).toThrow('unsigned update')
    expect(() =>
      assertPluginUpdateProvenance(installed, {
        source: 'marketplace',
        signatureVerified: true,
        signerKeyId: 'publisher-b',
      })
    ).toThrow('publisher')
  })
})

describe('unpackPluginArchive', () => {
  it('decodes a real zip with sizes from actual bytes', async () => {
    const { bytes } = await buildZip()
    const files = await unpackPluginArchive(bytes)
    const main = files.find((file) => file.path === 'main.js')
    expect(main?.bytes.byteLength).toBeGreaterThan(0)
  })

  it('rejects non-zip input and bounds expansion mid-decode', async () => {
    await expect(unpackPluginArchive(text('not a zip'))).rejects.toMatchObject({ code: 'archive' })
    // Highly-compressible payload (zip-bomb shape): tiny archive, huge expansion. The bound must trip
    // during decode, not after buffering everything.
    const zip = new JSZip()
    zip.file('yachiyo-plugin.json', '{}')
    zip.file('bomb.bin', new Uint8Array(4 * 1024 * 1024))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    await expect(
      unpackPluginArchive(bytes, { maxFiles: 512, maxTotalUnpackedBytes: 1024 * 1024 })
    ).rejects.toMatchObject({
      code: 'archive',
    })
  })

  it('rejects a zip with too many files', async () => {
    const zip = new JSZip()
    for (let index = 0; index < 6; index++) zip.file(`f${index}.json`, '{}')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    await expect(unpackPluginArchive(bytes, { maxFiles: 5, maxTotalUnpackedBytes: 1024 * 1024 })).rejects.toMatchObject(
      {
        code: 'archive',
      }
    )
  })

  it('counts directory entries toward the archive entry limit', async () => {
    const zip = new JSZip()
    for (let index = 0; index < 6; index++) zip.folder(`directory-${index}`)
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    await expect(unpackPluginArchive(bytes, { maxFiles: 5, maxTotalUnpackedBytes: 1024 })).rejects.toMatchObject({
      code: 'archive',
    })
  })

  it('rejects duplicate central-directory paths before JSZip can collapse them', async () => {
    const zip = new JSZip()
    zip.file('duplicate.txt', 'first')
    const original = await zip.generateAsync({ type: 'uint8array' })
    const originalView = new DataView(original.buffer, original.byteOffset, original.byteLength)
    let eocd = -1
    for (let offset = original.byteLength - 22; offset >= 0; offset--) {
      if (originalView.getUint32(offset, true) === 0x06054b50) {
        eocd = offset
        break
      }
    }
    expect(eocd).toBeGreaterThan(0)
    const centralOffset = originalView.getUint32(eocd + 16, true)
    const centralSize = originalView.getUint32(eocd + 12, true)
    const duplicate = original.slice(centralOffset, centralOffset + centralSize)
    const malicious = new Uint8Array(original.byteLength + duplicate.byteLength)
    malicious.set(original.slice(0, eocd), 0)
    malicious.set(duplicate, eocd)
    malicious.set(original.slice(eocd), eocd + duplicate.byteLength)
    const maliciousView = new DataView(malicious.buffer)
    const movedEocd = eocd + duplicate.byteLength
    maliciousView.setUint16(movedEocd + 8, 2, true)
    maliciousView.setUint16(movedEocd + 10, 2, true)
    maliciousView.setUint32(movedEocd + 12, centralSize + duplicate.byteLength, true)

    await expect(unpackPluginArchive(malicious)).rejects.toThrow('duplicate path')
  })
})

describe('PluginInstaller', () => {
  it('installs a verified package into its final directory atomically', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip()
    const record = await installer.install({
      packageBytes: bytes,
      source: 'https',
      now: 1000,
      updateSource: { kind: 'url', url: 'https://github.com/example/demo' },
    })
    expect(record.manifest.id).toBe('demo')
    expect(record.deviceGrantAllowed).toBe(false)
    expect(record.updateSource).toEqual({ kind: 'url', url: 'https://github.com/example/demo' })
    expect(fileStore.paths()).toEqual([
      `${pluginInstallDir(record)}/main.js`,
      `${pluginInstallDir(record)}/yachiyo-plugin.json`,
    ])
    expect((await registry.get('demo'))?.manifest.version).toBe('1.0.0')
    // No staging residue.
    expect(fileStore.paths().some((path) => path.includes('.staging-'))).toBe(false)
  })

  it('validates persisted registry identity and generated code paths', async () => {
    const { installer } = makeInstaller()
    const { bytes } = await buildZip()
    const record = await installer.install({ packageBytes: bytes, source: 'https', now: 1 })
    expect(parseInstalledPluginRecord(record, 'demo').manifest.id).toBe('demo')
    expect(() =>
      parseInstalledPluginRecord({ ...record, installDir: 'yachiyo-plugin-versions/demo/../../settings' }, 'demo')
    ).toThrow('plugin_record_path_invalid')
    expect(() => parseInstalledPluginRecord(record, 'other')).toThrow('plugin_record_identity_mismatch')
    expect(() =>
      parseInstalledPluginRecord({ ...record, updateSource: { kind: 'url', url: 'http://example.com/demo.zip' } })
    ).toThrow('plugin_update_source_invalid')
  })

  it('serializes concurrent mutations so the same plugin cannot commit twice', async () => {
    const { installer, fileStore } = makeInstaller()
    const { bytes } = await buildZip()
    const results = await Promise.allSettled([
      installer.install({ packageBytes: bytes, source: 'https', now: 1 }),
      installer.install({ packageBytes: bytes, source: 'https', now: 2 }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(fileStore.paths()).toHaveLength(2)
  })

  it('rejects an invalid package without writing anything', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip({ extraFiles: { 'undeclared.js': text('evil') } })
    await expect(installer.install({ packageBytes: bytes, source: 'https' })).rejects.toBeInstanceOf(PluginInstallError)
    expect(fileStore.paths()).toEqual([])
    expect(await registry.get('demo')).toBeNull()
  })

  it('enforces the aggregate retained-code quota before writing a stage', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const existingZip = await buildZip()
    const existing = await installer.install({ packageBytes: existingZip.bytes, source: 'https', now: 1 })
    registry.records.clear()
    registry.records.set('other', {
      ...existing,
      manifest: { ...existing.manifest, id: 'other' },
      unpackedBytes: PLUGIN_STORAGE_LIMITS.maxTotalBytes,
    })
    await fileStore.removeDir(pluginInstallDir(existing))
    const incoming = await buildZip()
    await expect(installer.install({ packageBytes: incoming.bytes, source: 'https', now: 2 })).rejects.toMatchObject({
      code: 'files',
      message: 'plugin_total_code_quota_exceeded',
    })
    expect(fileStore.paths()).toEqual([])
  })

  it('rolls back the staging directory when a mid-install write fails', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip()
    fileStore.failOnWritePath = 'main.js'
    await expect(installer.install({ packageBytes: bytes, source: 'https' })).rejects.toMatchObject({ code: 'archive' })
    expect(fileStore.paths()).toEqual([])
    expect(await registry.get('demo')).toBeNull()
  })

  it('rolls back committed files when registration fails', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip()
    registry.failOnPut = true
    await expect(installer.install({ packageBytes: bytes, source: 'https' })).rejects.toMatchObject({
      code: 'manifest',
    })
    expect(fileStore.paths()).toEqual([])
  })

  it('rejects reinstalling the same version and treats a new version as an update', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const v1 = await buildZip({ version: '1.0.0' })
    await installer.install({ packageBytes: v1.bytes, source: 'https', now: 1 })
    await expect(installer.install({ packageBytes: v1.bytes, source: 'https', now: 2 })).rejects.toMatchObject({
      code: 'manifest',
    })

    const v2 = await buildZip({ version: '1.1.0' })
    const updated = await installer.install({ packageBytes: v2.bytes, source: 'https', now: 3 })
    expect(updated.manifest.version).toBe('1.1.0')
    expect((await registry.get('demo'))?.manifest.version).toBe('1.1.0')
    expect(updated.previousVersions?.map((record) => record.manifest.version)).toEqual(['1.0.0'])
    expect(fileStore.paths()).toHaveLength(4)
  })

  it('blocks a package downgrade outside the explicit rollback path', async () => {
    const { installer } = makeInstaller()
    const current = await buildZip({ version: '2.0.0' })
    const older = await buildZip({ version: '1.9.0' })
    await installer.install({ packageBytes: current.bytes, source: 'https', now: 1 })
    await expect(installer.install({ packageBytes: older.bytes, source: 'https', now: 2 })).rejects.toMatchObject({
      code: 'manifest',
    })
  })

  it('keeps the old version intact when an update fails mid-write', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const v1 = await buildZip({ version: '1.0.0' })
    const installed = await installer.install({ packageBytes: v1.bytes, source: 'https', now: 1 })

    fileStore.failOnWritePath = 'main.js'
    const v2 = await buildZip({ version: '1.1.0' })
    await expect(installer.install({ packageBytes: v2.bytes, source: 'https', now: 2 })).rejects.toMatchObject({
      code: 'archive',
    })
    // v1 files and record untouched.
    expect((await registry.get('demo'))?.manifest.version).toBe('1.0.0')
    expect(fileStore.paths()).toEqual([
      `${pluginInstallDir(installed)}/main.js`,
      `${pluginInstallDir(installed)}/yachiyo-plugin.json`,
    ])
  })

  it('keeps the old version active when the registry pointer update fails', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const v1 = await buildZip({ version: '1.0.0' })
    const installed = await installer.install({ packageBytes: v1.bytes, source: 'https', now: 1 })
    registry.failOnPut = true
    const v2 = await buildZip({ version: '1.1.0' })
    await expect(installer.install({ packageBytes: v2.bytes, source: 'https', now: 2 })).rejects.toMatchObject({
      code: 'manifest',
    })
    expect((await registry.get('demo'))?.manifest.version).toBe('1.0.0')
    expect(fileStore.paths()).toEqual([
      `${pluginInstallDir(installed)}/main.js`,
      `${pluginInstallDir(installed)}/yachiyo-plugin.json`,
    ])
  })

  it('rolls back by atomically repointing to retained immutable bytes', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const v1 = await buildZip({ version: '1.0.0' })
    const v2 = await buildZip({ version: '1.1.0' })
    await installer.install({ packageBytes: v1.bytes, source: 'https', now: 1 })
    await installer.install({ packageBytes: v2.bytes, source: 'https', now: 2 })
    const rolledBack = await installer.rollback('demo')
    expect(rolledBack.manifest.version).toBe('1.0.0')
    expect(rolledBack.previousVersions?.[0].manifest.version).toBe('1.1.0')
    expect((await registry.get('demo'))?.manifest.version).toBe('1.0.0')
    expect(fileStore.paths()).toHaveLength(4)
  })

  it('compensates a post-install authorization failure without retaining the failed version', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const v1 = await buildZip({ version: '1.0.0' })
    const v2 = await buildZip({ version: '1.1.0' })
    const previous = await installer.install({ packageBytes: v1.bytes, source: 'https', now: 1 })
    await installer.install({ packageBytes: v2.bytes, source: 'https', now: 2 })
    await installer.restoreAfterFailedUpdate(previous)
    expect((await registry.get('demo'))?.manifest.version).toBe('1.0.0')
    expect(fileStore.paths()).toEqual([
      `${pluginInstallDir(previous)}/main.js`,
      `${pluginInstallDir(previous)}/yachiyo-plugin.json`,
    ])
  })

  it('bounds retained rollback versions and removes unreferenced code', async () => {
    const { installer, fileStore } = makeInstaller()
    let current: InstalledPluginRecord | null = null
    for (let index = 0; index < 6; index++) {
      const plugin = await buildZip({ version: `1.${index}.0` })
      current = await installer.install({ packageBytes: plugin.bytes, source: 'https', now: index + 1 })
    }
    expect(current?.previousVersions).toHaveLength(3)
    expect(fileStore.paths()).toHaveLength(8) // active plus three retained versions, two files each
  })

  it('reconciles staging and unreferenced immutable versions after an interrupted install', async () => {
    const { installer, fileStore } = makeInstaller()
    const { bytes } = await buildZip()
    const active = await installer.install({ packageBytes: bytes, source: 'https', now: 1 })
    const stage = `${PLUGIN_VERSIONS_DIR}/demo/.staging-${'b'.repeat(16)}-2`
    const orphan = `${PLUGIN_VERSIONS_DIR}/demo/${'c'.repeat(16)}-3`
    fileStore.files.set(`${stage}/main.js`, text('staging'))
    fileStore.files.set(`${orphan}/main.js`, text('orphan'))

    await installer.cleanupAbandonedCode()

    expect(await fileStore.exists(pluginInstallDir(active))).toBe(true)
    expect(await fileStore.exists(stage)).toBe(false)
    expect(await fileStore.exists(orphan)).toBe(false)
  })

  it('uninstalls record-first so no invisible orphan blocks reinstall', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip()
    await installer.install({ packageBytes: bytes, source: 'https', now: 1 })
    await installer.uninstall('demo')
    expect(await registry.get('demo')).toBeNull()
    expect(fileStore.paths()).toEqual([])
    // Reinstall works after uninstall.
    await installer.install({ packageBytes: bytes, source: 'https', now: 2 })
    expect((await registry.get('demo'))?.manifest.id).toBe('demo')
  })

  it('unregisters a plugin but reports code residue when directory deletion fails', async () => {
    const { installer, fileStore, registry } = makeInstaller()
    const { bytes } = await buildZip()
    await installer.install({ packageBytes: bytes, source: 'https', now: 1 })
    fileStore.failOnRemovePath = `${PLUGIN_VERSIONS_DIR}/demo`

    await expect(installer.uninstall('demo')).rejects.toMatchObject({
      code: 'files',
      message: expect.stringContaining('directory locked'),
    })
    expect(await registry.get('demo')).toBeNull()
    expect(fileStore.paths()).not.toEqual([])
  })

  it('rejects traversal-shaped ids on filesystem mutation APIs', async () => {
    const { installer } = makeInstaller()
    await expect(installer.uninstall('../settings')).rejects.toMatchObject({ code: 'manifest' })
    await expect(installer.rollback('../settings')).rejects.toMatchObject({ code: 'manifest' })
  })

  it('marketplace requires a signature even at install time', async () => {
    const { installer } = makeInstaller()
    const { bytes } = await buildZip()
    await expect(installer.install({ packageBytes: bytes, source: 'marketplace' })).rejects.toMatchObject({
      code: 'signature',
    })
  })
})
