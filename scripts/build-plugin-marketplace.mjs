import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const definitions = [
  {
    directory: 'ubuntu-runtime',
    files: ['main.js', 'ui/main.json'],
    repository: 'https://github.com/Wayne1145/yachiyo-claw',
  },
]
const keyId = 'newdreamstudio-official-v1'
const privateKeyPath = process.env.YACHIYO_PLUGIN_SIGNING_KEY
if (!privateKeyPath) throw new Error('YACHIYO_PLUGIN_SIGNING_KEY must point to the official P-256 private key.')
const privateKey = createPrivateKey(await readFile(resolve(privateKeyPath), 'utf8'))
if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Official marketplace signing key must be ECDSA P-256.')
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64url')
const trustRoots = JSON.parse(await readFile(resolve('src/shared/plugins/trusted-marketplace-signers.json'), 'utf8'))
const trusted = trustRoots.signers.find((entry) => entry.keyId === keyId)
if (!trusted || trusted.algorithm !== 'ecdsa-p256' || trusted.publicKey !== publicKey) {
  throw new Error(`Signing key does not match bundled trust root ${keyId}.`)
}

const packageDirectory = resolve('plugin-marketplace/packages')
await mkdir(packageDirectory, { recursive: true })
const plugins = []
for (const definition of definitions) {
  const root = resolve('examples/plugins', definition.directory)
  const entries = await Promise.all(definition.files.map(async (path) => {
    const bytes = await readFile(resolve(root, path))
    return { path, bytes, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.template.json'), 'utf8'))
  manifest.entrySha256 = entries.find((entry) => entry.path === manifest.entry)?.sha256
  manifest.files = entries.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
  const zip = new JSZip()
  zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
  for (const entry of entries) zip.file(entry.path, entry.bytes)
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const packageName = `${manifest.id}-${manifest.version}.zip`
  await writeFile(resolve(packageDirectory, packageName), bytes)
  plugins.push({
    id: manifest.id,
    name: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    packageUrl: `https://raw.githubusercontent.com/Wayne1145/yachiyo-claw/main/plugin-marketplace/packages/${packageName}`,
    packageSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature: {
      algorithm: 'ecdsa-p256',
      value: sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
      publicKey,
      keyId,
    },
    repository: definition.repository,
  })
}
plugins.sort((left, right) => left.id.localeCompare(right.id))
await writeFile(resolve('plugin-marketplace/index.json'), `${JSON.stringify({ schemaVersion: 1, plugins }, null, 2)}\n`)
process.stdout.write(`${plugins.length} official plugin package(s) built.\n`)
