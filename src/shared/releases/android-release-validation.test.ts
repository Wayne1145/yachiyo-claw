import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const verifier = path.resolve('scripts/verify-android-update-release.mjs')

function androidSdkRoot(): string {
  const candidates = [path.resolve('.tools/android-sdk'), process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]
  const root = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
  if (!root) throw new Error('Android SDK is required for release validation tests')
  return root
}

function latestVersionDirectory(root: string): string {
  const versions = readdirSync(root).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  if (!versions[0]) throw new Error(`No Android tool versions found under ${root}`)
  return path.join(root, versions[0])
}

function createApk(apk: string, applicationId: string, versionName: string, versionCode: number): void {
  const sdk = androidSdkRoot()
  const executable = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'
  const aapt2 = path.join(latestVersionDirectory(path.join(sdk, 'build-tools')), executable)
  const androidJar = path.join(latestVersionDirectory(path.join(sdk, 'platforms')), 'android.jar')
  if (!existsSync(aapt2) || !existsSync(androidJar)) throw new Error('aapt2 and android.jar are required')

  const manifest = path.join(path.dirname(apk), 'AndroidManifest.xml')
  writeFileSync(
    manifest,
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${applicationId}" android:versionCode="${versionCode}" android:versionName="${versionName}"><uses-sdk android:minSdkVersion="30" android:targetSdkVersion="35"/><application/></manifest>`
  )
  const result = spawnSync(aapt2, ['link', '--manifest', manifest, '-I', androidJar, '-o', apk], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(`Unable to create APK fixture: ${result.stderr || result.stdout}`)
}

function fixture(
  options: {
    projectApplicationId?: string
    projectVersion?: string
    projectVersionCode?: number
    apkApplicationId?: string
    apkVersion?: string
    apkVersionCode?: number
  } = {}
) {
  const projectApplicationId = options.projectApplicationId ?? 'io.github.yachiyoclaw'
  const projectVersion = options.projectVersion ?? '0.0.6'
  const projectVersionCode = options.projectVersionCode ?? 6
  const root = mkdtempSync(path.join(tmpdir(), 'yachiyo-update-release-'))
  mkdirSync(path.join(root, 'android', 'app'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: projectVersion }))
  writeFileSync(
    path.join(root, 'android', 'app', 'build.gradle'),
    `applicationId "${projectApplicationId}"\nversionCode ${projectVersionCode}\nversionName "${projectVersion}"\n`
  )
  const apk = path.join(root, 'yachiyo-claw-release.apk')
  createApk(
    apk,
    options.apkApplicationId ?? projectApplicationId,
    options.apkVersion ?? projectVersion,
    options.apkVersionCode ?? projectVersionCode
  )
  const digest = createHash('sha256').update(Uint8Array.from(readFileSync(apk))).digest('hex')
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
    expect(JSON.parse(output)).toMatchObject({
      applicationId: 'io.github.yachiyoclaw',
      version: '0.0.6',
      versionCode: 6,
      sha256: digest,
    })
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
    const { root, apk } = fixture({ projectVersion: '0.0.5', projectVersionCode: 5 })

    const result = spawnSync(
      process.execPath,
      [verifier, '--project-root', root, '--apk', apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be newer than 0.0.5')
  })

  it('rejects a 0.0.10 APK renamed as the 0.0.11 release', () => {
    const { root, apk } = fixture({
      projectVersion: '0.0.11',
      projectVersionCode: 11,
      apkVersion: '0.0.10',
      apkVersionCode: 10,
    })

    const result = spawnSync(
      process.execPath,
      [verifier, '--project-root', root, '--apk', apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('APK versionName 0.0.10 does not match project versionName 0.0.11')
  })

  it('rejects APK package and version-code mismatches', () => {
    const packageMismatch = fixture({ apkApplicationId: 'com.example.impostor' })
    const packageResult = spawnSync(
      process.execPath,
      [verifier, '--project-root', packageMismatch.root, '--apk', packageMismatch.apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(packageResult.status).toBe(1)
    expect(packageResult.stderr).toContain('APK applicationId com.example.impostor')

    const codeMismatch = fixture({ apkVersionCode: 5 })
    const codeResult = spawnSync(
      process.execPath,
      [verifier, '--project-root', codeMismatch.root, '--apk', codeMismatch.apk, '--skip-signature-check'],
      { encoding: 'utf8' }
    )
    expect(codeResult.status).toBe(1)
    expect(codeResult.stderr).toContain('APK versionCode 5 does not match project versionCode 6')
  })
})
