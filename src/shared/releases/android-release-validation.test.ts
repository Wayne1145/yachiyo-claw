import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const verifier = path.resolve('scripts/verify-android-update-release.mjs')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'yachiyo-update-release-'))
  mkdirSync(path.join(root, 'android', 'app'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.6' }))
  writeFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'versionCode 6\nversionName "0.0.6"\n')
  const apk = path.join(root, 'yachiyo-claw-release.apk')
  writeFileSync(apk, 'signed-apk-fixture')
  const digest = createHash('sha256').update('signed-apk-fixture').digest('hex')
  writeFileSync(`${apk}.sha256`, `${digest}  yachiyo-claw-release.apk\n`)
  return { root, apk, digest }
}

describe('Android update release verifier', () => {
  it('validates version progression, sidecar and official release metadata', () => {
    const { root, apk, digest } = fixture()
    const releaseJson = path.join(root, 'release.json')
    writeFileSync(
      releaseJson,
      JSON.stringify({
        tag_name: 'v0.0.6',
        draft: false,
        prerelease: false,
        assets: [
          {
            name: path.basename(apk),
            digest: `sha256:${digest}`,
            browser_download_url: `https://github.com/Wayne1145/yachiyo-claw/releases/download/v0.0.6/${path.basename(apk)}`,
          },
        ],
      })
    )

    const output = execFileSync(
      process.execPath,
      [verifier, '--project-root', root, '--apk', apk, '--release-json', releaseJson, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(JSON.parse(output)).toMatchObject({ version: '0.0.6', versionCode: 6, sha256: digest })
  })

  it('rejects a mismatched sidecar before release publication', () => {
    const { root, apk } = fixture()
    writeFileSync(`${apk}.sha256`, `${'0'.repeat(64)}  yachiyo-claw-release.apk\n`)

    const result = spawnSync(
      process.execPath,
      [verifier, '--project-root', root, '--apk', apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('sidecar does not match')
  })

  it('rejects versions that cannot upgrade the 0.0.5 baseline', () => {
    const { root, apk } = fixture()
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.5' }))
    writeFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'versionCode 5\nversionName "0.0.5"\n')

    const result = spawnSync(
      process.execPath,
      [verifier, '--project-root', root, '--apk', apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be newer than 0.0.5')
  })
})
