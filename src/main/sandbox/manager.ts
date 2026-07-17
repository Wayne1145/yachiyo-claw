import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { app } from 'electron'
import {
  TASK_SANDBOX_DENY_READ_PATHS,
  TASK_SANDBOX_DENY_WRITE_PATHS,
  TASK_SANDBOX_EXTRA_WRITE_PATHS,
} from '../../shared/task-sandbox'
import { getLogger } from '../util'
import { headTruncate, tailTruncate } from './truncate'

const log = getLogger('sandbox:manager')

type SandboxState = 'idle' | 'initialized'

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface ExecOptions {
  timeout?: number
  cwd?: string
}

interface SandboxStatus {
  state: SandboxState
  workingDirectory: string | null
  platform: string
}

let state: SandboxState = 'idle'
let workingDirectory: string | null = null
let runningChild: ChildProcess | null = null

let sandboxManagerRef: typeof import('@anthropic-ai/sandbox-runtime')['SandboxManager'] | null = null

function toWSLPath(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/')
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`
  }
  return normalized
}

function buildConfig(workDir: string): Omit<SandboxRuntimeConfig, 'network'> & {
  network: Omit<SandboxRuntimeConfig['network'], 'allowedDomains'>
} {
  const isMacOS = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const resolvedDir = isWindows ? toWSLPath(workDir) : workDir
  const allowWrite = [resolvedDir, ...TASK_SANDBOX_EXTRA_WRITE_PATHS]

  // WARN: `allowedDomains: ['*']` is NOT a wildcard — it's a literal match.
  // Omit `allowedDomains` so wrapWithSandbox generates `(allow network*)`.
  return {
    ...(isMacOS ? { ripgrep: { command: 'sh' } } : {}),
    network: {
      deniedDomains: [] as string[],
    },
    filesystem: {
      denyRead: [...TASK_SANDBOX_DENY_READ_PATHS],
      allowWrite,
      denyWrite: [...TASK_SANDBOX_DENY_WRITE_PATHS],
    },
  }
}

function getSandboxRuntimeImportTarget(): string {
  if (!app.isPackaged) {
    return '@anthropic-ai/sandbox-runtime'
  }

  const candidateEntries = [
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      'sandbox-runtime',
      'dist',
      'index.js'
    ),
    path.join(
      process.resourcesPath,
      'app.asar',
      'node_modules',
      '@anthropic-ai',
      'sandbox-runtime',
      'dist',
      'index.js'
    ),
  ]

  for (const candidate of candidateEntries) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  return '@anthropic-ai/sandbox-runtime'
}

export async function initSandbox(workDir: string): Promise<{ success: boolean; error?: string }> {
  if (state === 'initialized') {
    log.info('Sandbox already initialized, resetting first')
    await resetSandbox()
  }

  try {
    const { SandboxManager } = await import(getSandboxRuntimeImportTarget())
    sandboxManagerRef = SandboxManager

    const config = buildConfig(workDir)
    log.info(`Initializing sandbox for workDir=${workDir}, platform=${process.platform}`)
    await SandboxManager.initialize(config)

    workingDirectory = workDir
    state = 'initialized'
    log.info('Sandbox initialized successfully')
    return { success: true }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error('Sandbox initialization failed:', msg)
    sandboxManagerRef = null
    return { success: false, error: msg }
  }
}

export async function execCommand(command: string, options?: ExecOptions): Promise<ExecResult> {
  if (state !== 'initialized' || !sandboxManagerRef) {
    throw new Error('Sandbox not initialized. Call initSandbox first.')
  }

  const wrappedCommand = await sandboxManagerRef.wrapWithSandbox(command)
  const cwd = options?.cwd ?? workingDirectory ?? undefined
  const timeout = options?.timeout ?? 30_000

  return new Promise((resolve, reject) => {
    const stdoutChunks: Uint8Array[] = []
    const stderrChunks: Uint8Array[] = []

    const child = spawn(wrappedCommand, {
      shell: true,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    runningChild = child

    let timedOut = false
    const killTree = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      } else {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        } else {
          child.kill('SIGKILL')
        }
      }, 3_000)
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, timeout)

    child.stdout.on('data', (chunk: Uint8Array) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Uint8Array) => stderrChunks.push(chunk))

    child.on('error', (err) => {
      clearTimeout(timer)
      runningChild = null
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      runningChild = null
      const stdout = tailTruncate(Buffer.concat(stdoutChunks).toString('utf-8'))
      const stderr = tailTruncate(Buffer.concat(stderrChunks).toString('utf-8'))
      const exitCode = timedOut ? 124 : (code ?? 1)

      if (timedOut) {
        resolve({ stdout, stderr: `${stderr}\n[Process timed out after ${timeout}ms]`, exitCode })
      } else {
        resolve({ stdout, stderr, exitCode })
      }
    })
  })
}

export function killRunningCommand(): { killed: boolean } {
  if (runningChild && !runningChild.killed) {
    if (runningChild.pid) {
      try {
        process.kill(-runningChild.pid, 'SIGTERM')
      } catch {
        runningChild.kill('SIGTERM')
      }
    } else {
      runningChild.kill('SIGTERM')
    }
    log.info('Killed running sandbox command')
    return { killed: true }
  }
  return { killed: false }
}

export async function readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const result = await execCommand(`cat ${shellEscape(filePath)}`)
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true, content: headTruncate(result.stdout) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
  try {
    const escaped = content.replace(/'/g, "'\\''")
    const result = await execCommand(`printf '%s' '${escaped}' > ${shellEscape(filePath)}`)
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function editFile(
  filePath: string,
  search: string,
  replace: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const escapeSedBRE = (s: string) => s.replace(/[\\.*[\]^$&/]/g, '\\$&').replace(/\n/g, '\\n')
    const escapedSearch = escapeSedBRE(search)
    const escapedReplace = escapeSedBRE(replace)
    const result = await execCommand(`sed -i'' "s/${escapedSearch}/${escapedReplace}/g" ${shellEscape(filePath)}`)
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listDir(dirPath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const result = await execCommand(`ls -la ${shellEscape(dirPath)}`)
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true, content: headTruncate(result.stdout) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function grepFiles(
  pattern: string,
  dirPath?: string,
  options?: { include?: string }
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const target = dirPath ? shellEscape(dirPath) : '.'
    const includeFlag = options?.include ? `--include=${shellEscape(options.include)}` : ''
    const result = await execCommand(`grep -rn ${includeFlag} ${shellEscape(pattern)} ${target}`)
    // grep returns exit code 1 when no matches found — not an error
    if (result.exitCode > 1) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true, content: headTruncate(result.stdout) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function findFiles(
  dirPath: string,
  pattern?: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const nameFlag = pattern ? `-name ${shellEscape(pattern)}` : ''
    const result = await execCommand(`find ${shellEscape(dirPath)} ${nameFlag} -type f`)
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || `Exit code ${result.exitCode}` }
    }
    return { success: true, content: headTruncate(result.stdout) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function resetSandbox(): Promise<{ success: boolean; error?: string }> {
  try {
    if (sandboxManagerRef) {
      await sandboxManagerRef.reset()
    }
    state = 'idle'
    workingDirectory = null
    sandboxManagerRef = null
    log.info('Sandbox reset')
    return { success: true }
  } catch (error) {
    state = 'idle'
    workingDirectory = null
    sandboxManagerRef = null
    const msg = error instanceof Error ? error.message : String(error)
    log.error('Sandbox reset error:', msg)
    return { success: false, error: msg }
  }
}

export function getStatus(): SandboxStatus {
  return {
    state,
    workingDirectory,
    platform: process.platform,
  }
}

export async function checkAvailability(): Promise<{ available: boolean; reason?: string }> {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return { available: true }
  }

  if (process.platform === 'win32') {
    try {
      const result = await new Promise<{ stdout: string; exitCode: number }>((resolve, reject) => {
        const child = spawn('wsl', ['--status'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const chunks: Uint8Array[] = []
        child.stdout.on('data', (c: Uint8Array) => chunks.push(c))
        child.on('error', reject)
        child.on('close', (code) => resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), exitCode: code ?? 1 }))
      })
      if (result.exitCode === 0) {
        return { available: true }
      }
      return { available: false, reason: 'wsl2_required' }
    } catch {
      return { available: false, reason: 'wsl2_required' }
    }
  }

  return { available: false, reason: `Unsupported platform: ${process.platform}` }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
