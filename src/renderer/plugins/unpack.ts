import JSZip from 'jszip'
import { PLUGIN_PACKAGE_LIMITS } from '@shared/plugins/package'
import { type DecodedPackageFile, PluginInstallError } from '@shared/plugins/verify'

/**
 * Plugin archive unpacker (platform-27).
 *
 * Decompression is bounded WHILE decoding via JSZip's public `internalStream` chunk events — a
 * zip-bomb entry aborts mid-stream instead of ballooning into memory first. This deliberately avoids
 * the `_data.uncompressedSize` private-field pattern used by live2d-models.ts (a known fragility):
 * sizes here come only from actually-decoded bytes. Symlinks are detected from the unix permission
 * bits exactly like the Skills controller does; `verifyPluginPackage` then rejects them.
 */

// JSZip ships internalStream at runtime but its typings omit it; this is the public StreamHelper API
// (documented at stuk.github.io/jszip/documentation/api_streamhelper.html), not a private field.
interface ZipEntryStream {
  on(event: 'data', handler: (chunk: Uint8Array) => void): ZipEntryStream
  on(event: 'error', handler: (error: Error) => void): ZipEntryStream
  on(event: 'end', handler: () => void): ZipEntryStream
  pause(): ZipEntryStream
  resume(): ZipEntryStream
}
type StreamableZipEntry = JSZip.JSZipObject & { internalStream(type: 'uint8array'): ZipEntryStream }

function inspectCentralDirectoryPaths(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumEocd = 22
  const searchStart = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - minimumEocd; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new PluginInstallError('Plugin package ZIP directory is missing.', 'archive')
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const totalEntries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new PluginInstallError('Multi-disk and ZIP64 plugin packages are not supported.', 'archive')
  }
  if (centralOffset + centralSize > eocd || centralOffset < 0) {
    throw new PluginInstallError('Plugin package ZIP directory is invalid.', 'archive')
  }

  const paths = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = centralOffset
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new PluginInstallError('Plugin package ZIP directory entry is invalid.', 'archive')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (nameLength === 0 || end > eocd) {
      throw new PluginInstallError('Plugin package ZIP directory entry is truncated.', 'archive')
    }
    let path: string
    try {
      // ASCII names remain valid; legacy non-UTF8 names are rejected instead of being decoded
      // differently by the preflight scanner and JSZip.
      path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    } catch {
      throw new PluginInstallError('Plugin package file names must use UTF-8.', 'archive')
    }
    if (paths.has(path)) throw new PluginInstallError(`Plugin package contains duplicate path: ${path}`, 'archive')
    paths.add(path)
    offset = end
  }
  if (offset !== centralOffset + centralSize) {
    throw new PluginInstallError('Plugin package ZIP directory size is inconsistent.', 'archive')
  }
  return totalEntries
}

function readEntryBounded(entry: JSZip.JSZipObject, remainingBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const stream = (entry as StreamableZipEntry).internalStream('uint8array')
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return
      size += chunk.byteLength
      if (size > remainingBytes) {
        settled = true
        stream.pause()
        reject(new PluginInstallError('Plugin package expands beyond the size limit.', 'archive'))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', (error: Error) => {
      if (settled) return
      settled = true
      reject(new PluginInstallError(`Plugin package entry failed to decode: ${error.message}`, 'archive'))
    })
    stream.on('end', () => {
      if (settled) return
      settled = true
      const merged = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(merged)
    })
    stream.resume()
  })
}

export async function unpackPluginArchive(
  bytes: ArrayBuffer | Uint8Array,
  limits: { maxFiles: number; maxTotalUnpackedBytes: number; maxArchiveBytes?: number } = PLUGIN_PACKAGE_LIMITS
): Promise<DecodedPackageFile[]> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.byteLength > (limits.maxArchiveBytes ?? PLUGIN_PACKAGE_LIMITS.maxArchiveBytes)) {
    throw new PluginInstallError('Plugin package archive exceeds the size limit.', 'archive')
  }
  if (view.byteLength < 4 || view[0] !== 0x50 || view[1] !== 0x4b) {
    throw new PluginInstallError('Plugin package is not a ZIP archive.', 'archive')
  }
  const centralEntryCount = inspectCentralDirectoryPaths(view)
  if (centralEntryCount > limits.maxFiles) {
    throw new PluginInstallError('Plugin package has too many entries.', 'archive')
  }
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(view)
  } catch (error) {
    throw new PluginInstallError(
      `Plugin package could not be read: ${error instanceof Error ? error.message : 'corrupt archive'}`,
      'archive'
    )
  }

  const files: DecodedPackageFile[] = []
  let totalBytes = 0
  let fileCount = 0
  const entries = Object.entries(zip.files)
  if (entries.length !== centralEntryCount) {
    throw new PluginInstallError('Plugin package entries were collapsed while decoding.', 'archive')
  }
  for (const [relativePath, entry] of entries) {
    // unsafeOriginalName preserves traversal attempts JSZip would otherwise clean; the archive guard
    // in verifyPluginPackage must see (and reject) the original path, not a sanitized one.
    const path = (entry.unsafeOriginalName || relativePath).replace(/\\/g, '/')
    const unixPermissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0
    const type = (unixPermissions & 0o170000) === 0o120000 ? 'symlink' : entry.dir ? 'directory' : 'file'
    if (type !== 'file') {
      files.push({ path, bytes: new Uint8Array(), type })
      continue
    }
    fileCount += 1
    if (fileCount > limits.maxFiles) throw new PluginInstallError('Plugin package has too many files.', 'archive')
    const data = await readEntryBounded(entry, limits.maxTotalUnpackedBytes - totalBytes)
    totalBytes += data.byteLength
    files.push({ path, bytes: data, type: 'file' })
  }
  return files
}
