import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const root = resolve(process.cwd(), 'examples/plugins/hello-yachiyo')
const marketplace = resolve(process.cwd(), 'plugin-marketplace')
const packageDirectory = resolve(marketplace, 'packages')
const fileEntries = await Promise.all(
  ['main.js', 'ui/main.json'].map(async (path) => {
    const bytes = await readFile(resolve(root, path))
    return {
      path,
      bytes,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }),
)
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.template.json'), 'utf8'))
manifest.entrySha256 = fileEntries.find((file) => file.path === manifest.entry).sha256
manifest.files = fileEntries.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
const zip = new JSZip()
zip.file('yachiyo-plugin.json', JSON.stringify(manifest, null, 2))
for (const file of fileEntries) zip.file(file.path, file.bytes)
const packageBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

if (!process.env.YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY) {
  throw new Error('YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY must point to the official P-256 private key.')
}
const privateKey = createPrivateKey(
  await readFile(resolve(process.env.YACHIYO_EXAMPLE_PLUGIN_SIGNING_KEY), 'utf8'),
)
if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Example marketplace signing key must be ECDSA P-256.')
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
const trustRoots = JSON.parse(
  await readFile(resolve(process.cwd(), 'src/shared/plugins/trusted-marketplace-signers.json'), 'utf8'),
)
const keyId = 'newdreamstudio-example-v1'
const trustedSigner = trustRoots.signers.find((entry) => entry.keyId === keyId)
if (!trustedSigner || trustedSigner.algorithm !== 'ecdsa-p256' || trustedSigner.publicKey !== publicKey.toString('base64url')) {
  throw new Error(`Signing key does not match the bundled trust root ${keyId}.`)
}
const signature = sign('sha256', packageBytes, { key: privateKey, dsaEncoding: 'ieee-p1363' })
const packageName = 'hello-yachiyo-1.0.0.zip'
const catalog = {
  schemaVersion: 1,
  plugins: [
    {
      id: manifest.id,
      name: manifest.displayName,
      description: manifest.description,
      version: manifest.version,
      packageUrl: `https://raw.githubusercontent.com/Wayne1145/yachiyo-claw/main/plugin-marketplace/packages/${packageName}`,
      packageSize: packageBytes.byteLength,
      sha256: createHash('sha256').update(packageBytes).digest('hex'),
      signature: {
        algorithm: 'ecdsa-p256',
        value: signature.toString('base64url'),
        publicKey: publicKey.toString('base64url'),
        keyId,
      },
      repository: 'https://github.com/Wayne1145/yachiyo-claw',
    },
  ],
}

await mkdir(packageDirectory, { recursive: true })
await writeFile(resolve(packageDirectory, packageName), packageBytes)
await writeFile(resolve(marketplace, 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`)
process.stdout.write(`${resolve(packageDirectory, packageName)}\n`)
