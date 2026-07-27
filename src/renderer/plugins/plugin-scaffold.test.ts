import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyPluginPackage } from '@shared/plugins/verify'
import { unpackPluginArchive } from './unpack'

const execFileAsync = promisify(execFile)
const output = resolve(process.cwd(), '.cache/tests/plugin-scaffold/demo-plugin')

afterEach(async () => {
  await rm(resolve(process.cwd(), '.cache/tests/plugin-scaffold'), { recursive: true, force: true })
})

describe('plugin scaffold', () => {
  it('generates a complete package whose digests pass the production verifier', async () => {
    await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'scripts/create-plugin.mjs'),
      '--id',
      'demo-plugin',
      '--name',
      'Demo Plugin',
      '--output',
      '.cache/tests/plugin-scaffold/demo-plugin',
      '--force',
    ])
    const packageBytes = new Uint8Array(await readFile(resolve(output, 'demo-plugin.zip')))
    const files = await unpackPluginArchive(packageBytes)
    const verified = await verifyPluginPackage({ packageBytes, files, source: 'sideload' })
    expect(verified.manifest.id).toBe('demo-plugin')
    expect(verified.manifest.capabilities.map((entry) => entry.name)).toEqual(['storage', 'ui', 'tools'])
    expect(verified.manifest.entrySha256).toMatch(/^[a-f0-9]{64}$/)

    const zip = await JSZip.loadAsync(packageBytes)
    expect(Object.keys(zip.files).sort()).toEqual(['main.js', 'ui/', 'ui/main.json', 'yachiyo-plugin.json'])
  })

  it('never treats the workspace root as a force-replaceable plugin output', async () => {
    await expect(
      execFileAsync(process.execPath, [
        resolve(process.cwd(), 'scripts/create-plugin.mjs'),
        '--id',
        'dangerous-output',
        '--name',
        'Dangerous Output',
        '--output',
        '.',
        '--force',
      ])
    ).rejects.toThrow('Command failed')
    await expect(readFile(resolve(process.cwd(), 'package.json'), 'utf8')).resolves.toContain('yachiyo-claw')
  })
})
