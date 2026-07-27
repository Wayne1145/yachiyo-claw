import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const root = resolve(process.cwd(), 'examples/plugins/hello-yachiyo')
const output = resolve(root, 'hello-yachiyo.zip')
const files = await Promise.all(
  ['main.js', 'ui/main.json'].map(async (path) => {
    const bytes = await readFile(resolve(root, path))
    return { path, bytes, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }),
)
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.template.json'), 'utf8'))
manifest.entrySha256 = files.find((file) => file.path === manifest.entry).sha256
manifest.files = files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
const zip = new JSZip()
zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
for (const file of files) zip.file(file.path, file.bytes)
await writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
process.stdout.write(`${output}\n`)
