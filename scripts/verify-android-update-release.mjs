#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_APK_BYTES = 512 * 1024 * 1024
const OFFICIAL_DOWNLOAD_PREFIX = 'https://github.com/wayne1145/yachiyo-claw/releases/download/'

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) fail(`Unexpected argument: ${key}`)
    if (key === '--skip-signature-check') {
      result.skipSignatureCheck = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for ${key}`)
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
    index += 1
  }
  return result
}

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) fail(`${label} must use stable x.y.z format: ${value}`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const a = parseVersion(left, 'Version')
  const b = parseVersion(right, 'Previous version')
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function sha256File(file) {
  const digest = createHash('sha256')
  const descriptor = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
  return digest.digest('hex')
}

function parseSidecar(file) {
  const value = readFileSync(file, 'utf8')
  const match = /^\s*([0-9a-f]{64})(?:\s+[*]?.+)?\s*$/i.exec(value)
  if (!match) fail(`Invalid SHA-256 sidecar: ${file}`)
  return match[1].toLowerCase()
}

function findApkSigner(projectRoot) {
  const buildTools = join(projectRoot, '.tools', 'android-sdk', 'build-tools')
  if (!existsSync(buildTools)) return null
  const java = join(process.env.JAVA_HOME || '', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!existsSync(java)) return null
  const versions = readdirSync(buildTools).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const version of versions) {
    const jar = join(buildTools, version, 'lib', 'apksigner.jar')
    if (existsSync(jar)) return { command: java, prefix: ['-jar', jar] }
  }
  return null
}

function signerDigest(apksigner, apk) {
  const result = spawnSync(apksigner.command, [...apksigner.prefix, 'verify', '--verbose', '--print-certs', apk], {
    encoding: 'utf8',
  })
  if (result.status !== 0) fail(`APK signature verification failed: ${(result.stderr || result.stdout).trim()}`)
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(result.stdout)
  if (!match) fail(`Could not read APK signer digest: ${apk}`)
  return match[1].toLowerCase()
}

function verifyReleaseJson(file, version, apkName, digest) {
  const release = JSON.parse(readFileSync(file, 'utf8'))
  if (release.draft || release.prerelease) fail('Release must be stable and published')
  if (release.tag_name !== version && release.tag_name !== `v${version}`) {
    fail(`Release tag ${release.tag_name} does not match ${version}`)
  }
  const assets = Array.isArray(release.assets) ? release.assets : []
  const apk = assets.find((asset) => asset.name === apkName)
  if (!apk) fail(`Release does not contain ${apkName}`)
  const url = String(apk.browser_download_url || '').toLowerCase()
  if (!url.startsWith(OFFICIAL_DOWNLOAD_PREFIX)) fail('APK download URL is not the official GitHub Release path')
  const githubDigest = String(apk.digest || '').replace(/^sha256:/i, '').toLowerCase()
  const sidecar = assets.find((asset) => asset.name === `${apkName}.sha256` || asset.name === apkName.replace(/\.apk$/i, '.sha256'))
  if (githubDigest && githubDigest !== digest) fail('GitHub asset digest does not match the local APK')
  if (!githubDigest && !sidecar) fail('Release must expose an asset digest or matching SHA-256 sidecar')
  if (sidecar && !String(sidecar.browser_download_url || '').toLowerCase().startsWith(OFFICIAL_DOWNLOAD_PREFIX)) {
    fail('SHA-256 sidecar URL is not the official GitHub Release path')
  }
}

export function verifyAndroidUpdateRelease(options) {
  const projectRoot = resolve(options.projectRoot || process.cwd())
  const apk = resolve(projectRoot, options.apk || '')
  if (!options.apk || !existsSync(apk)) fail(`APK not found: ${apk}`)
  const apkName = basename(apk)
  if (!/\.apk$/i.test(apkName) || /debug/i.test(apkName)) fail('Release asset must be a non-debug APK')
  const apkSize = statSync(apk).size
  if (apkSize <= 0 || apkSize > MAX_APK_BYTES) fail(`APK size must be between 1 and ${MAX_APK_BYTES} bytes`)

  const sidecar = resolve(projectRoot, options.sidecar || `${options.apk}.sha256`)
  if (!existsSync(sidecar)) fail(`SHA-256 sidecar not found: ${sidecar}`)
  const digest = sha256File(apk)
  if (parseSidecar(sidecar) !== digest) fail('SHA-256 sidecar does not match the APK')

  const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const gradle = readFileSync(join(projectRoot, 'android', 'app', 'build.gradle'), 'utf8')
  const versionName = /versionName\s+["']([^"']+)["']/.exec(gradle)?.[1]
  const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1])
  if (!versionName || !Number.isInteger(versionCode)) fail('Could not read Android versionName/versionCode')
  if (packageJson.version !== versionName) fail('package.json version and Android versionName must match')

  const previousVersion = options.previousVersion || '0.0.5'
  const previousVersionCode = Number(options.previousVersionCode || 5)
  if (compareVersions(versionName, previousVersion) <= 0) fail(`${versionName} must be newer than ${previousVersion}`)
  if (versionCode <= previousVersionCode) fail(`versionCode ${versionCode} must be greater than ${previousVersionCode}`)

  if (!options.skipSignatureCheck) {
    const apksigner = findApkSigner(projectRoot)
    if (!apksigner) fail('apksigner was not found under .tools/android-sdk/build-tools')
    const currentSigner = signerDigest(apksigner, apk)
    if (!options.previousApk) fail('--previous-apk is required to verify update signing continuity')
    const previousApk = resolve(projectRoot, options.previousApk)
    if (!existsSync(previousApk)) fail(`Previous APK not found: ${previousApk}`)
    if (signerDigest(apksigner, previousApk) !== currentSigner) fail('Previous and next APK signer certificates do not match')
  }

  if (options.releaseJson) verifyReleaseJson(resolve(projectRoot, options.releaseJson), versionName, apkName, digest)
  return { version: versionName, versionCode, apkName, apkSize, sha256: digest }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = verifyAndroidUpdateRelease(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Android update release verification failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
