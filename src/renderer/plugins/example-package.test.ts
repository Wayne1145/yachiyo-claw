import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyPluginPackage } from '@shared/plugins/verify'
import { parsePluginView } from '@shared/plugins/view-schema'
import { sha256Hex } from '@shared/skills/skillhub'

describe('hello-yachiyo example package', () => {
  it('builds a manifest accepted by the production verifier', async () => {
    const root = resolve(process.cwd(), 'examples/plugins/hello-yachiyo')
    const main = new Uint8Array(await readFile(resolve(root, 'main.js')))
    const view = new Uint8Array(await readFile(resolve(root, 'ui/main.json')))
    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.template.json'), 'utf8'))
    const files = [
      { path: 'main.js', bytes: main, sha256: await sha256Hex(main) },
      { path: 'ui/main.json', bytes: view, sha256: await sha256Hex(view) },
    ]
    manifest.entrySha256 = files[0].sha256
    manifest.files = files.map((file) => ({ path: file.path, size: file.bytes.byteLength, sha256: file.sha256 }))
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
    const verified = await verifyPluginPackage({
      packageBytes: new TextEncoder().encode('example-package'),
      source: 'sideload',
      files: [
        { path: 'yachiyo-plugin.json', bytes: manifestBytes },
        ...files.map((file) => ({ path: file.path, bytes: file.bytes })),
      ],
    })
    expect(verified.manifest.id).toBe('hello-yachiyo')
    expect(verified.manifest.contributions.view).toBe('ui/main.json')
    expect(() => parsePluginView(JSON.parse(new TextDecoder().decode(view)))).not.toThrow()
  })
})
