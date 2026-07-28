import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const paths = ['main.js', 'ui/main.json']
const files = await Promise.all(
  paths.map(async (path) => {
    const bytes = await readFile(new URL(path, import.meta.url))
    return { path, bytes, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }),
)
const manifest = JSON.parse(await readFile(new URL('manifest.template.json', import.meta.url), 'utf8'))
manifest.entrySha256 = files.find((file) => file.path === manifest.entry).sha256
manifest.files = files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
const zip = new JSZip()
zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
for (const file of files) zip.file(file.path, file.bytes)
await writeFile(new URL('error-help-center.zip', import.meta.url), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
