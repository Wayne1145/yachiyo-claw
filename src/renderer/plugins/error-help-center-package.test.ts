import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyPluginPackage } from '@shared/plugins/verify'
import { parsePluginView } from '@shared/plugins/view-schema'
import { sha256Hex } from '@shared/skills/skillhub'

describe('error help center plugin package', () => {
  it('declares a safe settings contribution and a searchable host-rendered view', async () => {
    const root = resolve(process.cwd(), 'examples/plugins/error-help-center')
    const main = new Uint8Array(await readFile(resolve(root, 'main.js')))
    const view = new Uint8Array(await readFile(resolve(root, 'ui/main.json')))
    const manifest = JSON.parse(await readFile(resolve(root, 'manifest.template.json'), 'utf8'))
    const files = [
      { path: 'main.js', bytes: main, sha256: await sha256Hex(main) },
      { path: 'ui/main.json', bytes: view, sha256: await sha256Hex(view) },
    ]
    manifest.entrySha256 = files[0].sha256
    manifest.files = files.map((file) => ({ path: file.path, size: file.bytes.byteLength, sha256: file.sha256 }))
    const verified = await verifyPluginPackage({
      packageBytes: new TextEncoder().encode('error-help-center-package'),
      source: 'sideload',
      files: [
        { path: 'yachiyo-plugin.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
        ...files.map((file) => ({ path: file.path, bytes: file.bytes })),
      ],
    })
    expect(verified.manifest.id).toBe('error-help-center')
    expect(verified.manifest.contributions.settingsEntries?.[0]?.route).toBe('/plugin/error-help-center')
    expect(() => parsePluginView(JSON.parse(new TextDecoder().decode(view)))).not.toThrow()
  })

  it('keeps long error codes out of the 32-character list badge field', async () => {
    const source = await readFile(resolve(process.cwd(), 'examples/plugins/error-help-center/main.js'), 'utf8')
    const tools = new Map<string, (args: unknown) => unknown>()
    new Function('yachiyo', source)({ registerTool: (name: string, handler: (args: unknown) => unknown) => tools.set(name, handler) })

    const view = tools.get('render')?.({})
    expect(() => parsePluginView(view)).not.toThrow()
    const results = (view as {
      children: Array<{ key: string; items?: Array<{ title: string; description?: string; badge?: string }> }>
    }).children.find(
      (node) => node.key === 'results',
    )?.items
    const longCode = results?.find((item) => item.description?.includes('plugin_marketplace_identity_mismatch'))
    expect(longCode?.badge).toBe('插件')
    expect(longCode?.badge?.length).toBeLessThanOrEqual(32)
  })
})
