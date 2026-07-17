import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function readRequiredFile(relativePath) {
  const absolutePath = join(workspaceRoot, relativePath)
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: required file is missing`)
    return ''
  }
  return readFileSync(absolutePath, 'utf8')
}

function collectSourceFiles(relativeDirectory, extensions) {
  const absoluteDirectory = join(workspaceRoot, relativeDirectory)
  if (!existsSync(absoluteDirectory)) {
    failures.push(`${relativeDirectory}: required source directory is missing; run pnpm install first`)
    return []
  }

  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(entryPath)
      } else if (entry.isFile() && extensions.has(extname(entry.name))) {
        files.push(entryPath)
      }
    }
  }
  visit(absoluteDirectory)
  return files
}

function findLine(source, index) {
  return source.slice(0, index).split(/\r?\n/).length
}

function forbidPatterns(scope, files, patterns) {
  for (const absolutePath of files) {
    const source = readFileSync(absolutePath, 'utf8')
    const displayPath = relative(workspaceRoot, absolutePath).replaceAll('\\', '/')
    for (const { label, pattern } of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(source)) !== null) {
        failures.push(`${displayPath}:${findLine(source, match.index)}: ${label}`)
        if (match[0].length === 0) pattern.lastIndex += 1
      }
    }
  }

  if (files.length === 0) failures.push(`${scope}: no source files were found`)
}

const directOutputPatterns = [
  { label: 'direct Android Logcat access is forbidden', pattern: /\bandroid\.util\.Log\b/g },
  { label: 'standard output/error is forbidden', pattern: /\b(?:java\.lang\.)?System\.(?:out|err)\b/g },
  { label: 'stack trace output is forbidden', pattern: /\.printStackTrace\s*\(/g },
]

const capacitorConfig = readRequiredFile('capacitor.config.ts')
if (!/\bandroid\s*:\s*\{[\s\S]*?\bloggingBehavior\s*:\s*['"]none['"]/m.test(capacitorConfig)) {
  failures.push("capacitor.config.ts: android.loggingBehavior must remain 'none'")
}

const sqliteRoot = 'node_modules/@capacitor-community/sqlite/android/src/main/java'
const sqliteFiles = collectSourceFiles(sqliteRoot, new Set(['.java']))
forbidPatterns('Capacitor SQLite', sqliteFiles, directOutputPatterns)

const sqlitePrivacyLog = readRequiredFile(
  `${sqliteRoot}/com/getcapacitor/community/database/sqlite/Log.java`
)
if (!sqlitePrivacyLog.includes('Yachiyo Claw keeps every level silent in both debug and release builds.')) {
  failures.push('Capacitor SQLite: the Yachiyo privacy logging patch is not installed')
}
for (const level of ['v', 'd', 'i', 'e']) {
  if (!new RegExp(`public static int ${level}\\s*\\(`).test(sqlitePrivacyLog)) {
    failures.push(`Capacitor SQLite: privacy logger is missing the ${level}() level`)
  }
}

const streamHttpRoot = 'node_modules/capacitor-stream-http/android/src/main/java'
const streamHttpFiles = collectSourceFiles(streamHttpRoot, new Set(['.java', '.kt']))
forbidPatterns('Capacitor Stream HTTP', streamHttpFiles, [
  ...directOutputPatterns,
  { label: 'network plugin Logcat call is forbidden', pattern: /\bLog\.[vdiewtf]\s*\(/g },
])

const streamHttpSource = readRequiredFile(
  `${streamHttpRoot}/com/chatbox/plugins/streamhttp/StreamHttpPlugin.java`
)
if (!streamHttpSource.includes('Requests can carry API keys and conversation bodies')) {
  failures.push('Capacitor Stream HTTP: the Yachiyo privacy logging patch is not installed')
}

const firstPartyNativeFiles = collectSourceFiles('android/app/src/main/java', new Set(['.java', '.kt']))
forbidPatterns('Yachiyo native Android code', firstPartyNativeFiles, [
  ...directOutputPatterns,
  { label: 'first-party Logcat call is forbidden', pattern: /\bLog\.[vdiewtf]\s*\(/g },
  { label: 'Capacitor Logger call is forbidden', pattern: /\bLogger\.(?:verbose|debug|info|warn|error)\s*\(/g },
])

if (failures.length > 0) {
  console.error('Android native log privacy gate failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Android native log privacy gate passed (${sqliteFiles.length + streamHttpFiles.length + firstPartyNativeFiles.length} source files checked).`)
}
