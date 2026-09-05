import { generateKeyPairSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const output = resolve(process.argv[2] || '.keys/newdreamstudio-plugin-p256.pem')
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'der' },
})
await mkdir(dirname(output), { recursive: true })
await writeFile(output, privateKey, { mode: 0o600, flag: 'wx' })
process.stdout.write(`${output}\n${publicKey.toString('base64url')}\n`)
