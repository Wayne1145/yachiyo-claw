import { SkillScriptEntrypointSchema, type SkillScriptCapability } from '@shared/types/skills'
import { requestAgentApproval } from './agent-approval'
import { executeAgentAction } from './agent-broker'
import { yachiyoSandboxNative } from '@/platform/native/yachiyo_sandbox'

const MAX_RESULT_BYTES = 64 * 1024

export interface InstalledMobileSkillScript {
  entrypoint: unknown
  scriptBase64: string
}

export interface MobileSkillScriptExecutionOptions {
  skillName: string
  script: InstalledMobileSkillScript
  args?: string[]
  grantedCapabilities: SkillScriptCapability[]
  sessionId?: string
  toolCallId?: string
  abortSignal?: AbortSignal
  signatureVerified: boolean
}

export interface MobileSkillScriptResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut?: boolean
  truncated?: boolean
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function truncateUtf8(value: string): { value: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= MAX_RESULT_BYTES) return { value, truncated: false }
  return {
    value: new TextDecoder().decode(encoded.slice(0, MAX_RESULT_BYTES)),
    truncated: true,
  }
}

async function verifyScript(scriptBase64: string, expectedSha256: string, expectedSize: number): Promise<void> {
  const bytes = decodeBase64(scriptBase64)
  if (bytes.byteLength !== expectedSize) throw new Error('skill_script_size_mismatch')
  const ownedBytes = new Uint8Array(bytes.byteLength)
  ownedBytes.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', ownedBytes.buffer)
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== expectedSha256.toLowerCase()) throw new Error('skill_script_hash_mismatch')
}

async function runAbortable<T>(run: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return run
  if (signal.aborted) throw new Error('skill_script_cancelled')
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      void yachiyoSandboxNative.kill().finally(() => reject(new Error('skill_script_cancelled')))
    }
    signal.addEventListener('abort', cancel, { once: true })
    run.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function scriptCommand(
  runtime: 'shell' | 'python' | 'javascript',
  scriptPath: string,
  workingDirectory: 'skill-private' | 'workspace',
  args: string[],
): string {
  const runner = runtime === 'python' ? 'python3' : runtime === 'javascript' ? 'node' : '/bin/sh'
  const privateRoot = scriptPath.slice(0, scriptPath.lastIndexOf('/'))
  const entrypoint = workingDirectory === 'skill-private' ? scriptPath.slice(privateRoot.length + 1) : scriptPath
  const cwd = workingDirectory === 'skill-private' ? privateRoot : '/workspace'
  return `cd ${shellQuote(cwd)} && ${runner} ${shellQuote(entrypoint)}${args.length ? ` ${args.map(shellQuote).join(' ')}` : ''}`
}

/** Execute one installed, hash-bound entrypoint inside the app-private Linux sandbox. */
export async function executeMobileSkillScript(
  options: MobileSkillScriptExecutionOptions,
): Promise<MobileSkillScriptResult> {
  const entrypoint = SkillScriptEntrypointSchema.parse(options.script.entrypoint)
  const args = options.args || []
  if (args.length > 64 || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new Error('invalid_skill_script_arguments')
  }
  if (new TextEncoder().encode(args.join('')).byteLength > 16 * 1024)
    throw new Error('skill_script_arguments_too_large')
  const missingCapabilities = entrypoint.capabilities.filter(
    (capability) => !options.grantedCapabilities.includes(capability),
  )
  if (missingCapabilities.length) throw new Error(`skill_capability_not_granted:${missingCapabilities.join(',')}`)
  await verifyScript(options.script.scriptBase64, entrypoint.sha256, entrypoint.size)

  const approved = await requestAgentApproval({
    sessionId: options.sessionId,
    runId: options.sessionId,
    title: `Run Skill script: ${options.skillName}/${entrypoint.name}`,
    detail: JSON.stringify({
      runtime: entrypoint.runtime,
      args,
      workingDirectory: entrypoint.workingDirectory,
      isolation: 'android-proot-alpine',
      capabilities: entrypoint.capabilities,
      sha256: entrypoint.sha256,
    }),
    risk: 'dangerous',
    signal: options.abortSignal,
  })
  if (!approved) return { success: false, stdout: '', stderr: 'skill_script_approval_denied', exitCode: 126 }

  const scriptRoot = `.yachiyo/skills/${options.skillName}/${entrypoint.sha256.slice(0, 16)}`
  const scriptPath = `${scriptRoot}/${entrypoint.path}`
  const scriptText = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(options.script.scriptBase64))
  const writeResult = await yachiyoSandboxNative.write({ filePath: scriptPath, content: scriptText })
  if (!writeResult.success) throw new Error(writeResult.error || 'skill_script_stage_failed')
  const command = scriptCommand(entrypoint.runtime, scriptPath, entrypoint.workingDirectory, args)

  const executionParameters = {
    skillName: options.skillName,
    entrypointName: entrypoint.name,
    runtime: entrypoint.runtime,
    scriptSha256: entrypoint.sha256,
    args,
    workingDirectory: entrypoint.workingDirectory,
    capabilities: entrypoint.capabilities,
    signatureVerified: options.signatureVerified,
  }
  const result = await executeAgentAction({
    toolId: 'skill.script.execute',
    backend: 'sandbox',
    parameters: executionParameters,
    taskId: options.sessionId,
    toolCallId: options.toolCallId,
    abortSignal: options.abortSignal,
    deadline: Date.now() + entrypoint.timeoutMs + 5_000,
    sideEffect: true,
    failureState: 'unknown',
    isSuccess: (value) => value.exitCode === 0,
    resultToJson: (value) => ({ exitCode: value.exitCode, timedOut: value.timedOut }),
    execute: () =>
      runAbortable(yachiyoSandboxNative.exec({ command, timeout: entrypoint.timeoutMs }), options.abortSignal).then(
        (value) => ({ ...value, timedOut: value.exitCode === 124 }),
      ),
  })
  const stdout = truncateUtf8(result.stdout)
  const stderr = truncateUtf8(result.stderr)
  return {
    success: result.exitCode === 0,
    stdout: stdout.value,
    stderr: stderr.value,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    truncated: stdout.truncated || stderr.truncated,
  }
}
