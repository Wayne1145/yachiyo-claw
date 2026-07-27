import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [packagePath, privateKeyPath, keyId] = process.argv.slice(2)
if (!packagePath || !privateKeyPath) {
  throw new Error('Usage: sign-plugin-package.mjs <plugin.zip> <p256-private-key.pem> [key-id]')
}
const bytes = await readFile(resolve(packagePath))
const privateKey = createPrivateKey(await readFile(resolve(privateKeyPath), 'utf8'))
if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
  throw new Error('Plugin signing requires an ECDSA P-256 private key.')
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
const signature = sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' })
process.stdout.write(
  `${JSON.stringify(
    {
      packageSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      signature: {
        algorithm: 'ecdsa-p256',
        value: signature.toString('base64url'),
        publicKey: publicKey.toString('base64url'),
        ...(keyId ? { keyId } : {}),
      },
    },
    null,
    2,
  )}\n`,
)
