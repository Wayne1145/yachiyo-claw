import { SkillScriptEntrypointSchema, type SkillScriptCapability } from '@shared/types/skills'
import { requestAgentApproval } from './agent-approval'
import {
  executeAgentAction,
  getAgentBackend,
  getAgentWorkingDirectory,
  isAgentFullAccessEnabled,
} from './agent-broker'
import { yachiyoAgentNative } from '@/platform/native/yachiyo_agent'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'

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

async function runAbortable<T>(run: Promise<T>, signal: AbortSignal | undefined, executionId: string): Promise<T> {
  if (!signal) return run
  if (signal.aborted) throw new Error('skill_script_cancelled')
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      const backend = getAgentBackend()
      const cancellation =
        backend === 'shizuku' ? yachiyoDeviceAccessNative.cancelShizukuScript(executionId) : yachiyoAgentNative.kill()
      void cancellation.finally(() => reject(new Error('skill_script_cancelled')))
    }
    signal.addEventListener('abort', cancel, { once: true })
    run.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

async function requestNativeAuthorization(
  options: Parameters<typeof yachiyoDeviceAccessNative.requestSkillScriptAuthorization>[0],
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('skill_script_cancelled')
  const authorization = yachiyoDeviceAccessNative.requestSkillScriptAuthorization(options)
  if (!signal) {
    const result = await authorization
    if (!result.approvalNonce) throw new Error('skill_script_native_approval_denied')
    return result.approvalNonce
  }
  return new Promise<string>((resolve, reject) => {
    const abort = () => {
      void yachiyoDeviceAccessNative.cancelOperationApproval().finally(() => reject(new Error('skill_script_cancelled')))
    }
    signal.addEventListener('abort', abort, { once: true })
    authorization
      .then((result) => {
        if (!result.approvalNonce) throw new Error('skill_script_native_approval_denied')
        resolve(result.approvalNonce)
      }, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Execute one installed, hash-bound entrypoint through the Android Tool Broker. */
export async function executeMobileSkillScript(
  options: MobileSkillScriptExecutionOptions
): Promise<MobileSkillScriptResult> {
  const entrypoint = SkillScriptEntrypointSchema.parse(options.script.entrypoint)
  const args = options.args || []
  if (args.length > 64 || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new Error('invalid_skill_script_arguments')
  }
  if (new TextEncoder().encode(args.join('')).byteLength > 16 * 1024) throw new Error('skill_script_arguments_too_large')
  const missingCapabilities = entrypoint.capabilities.filter(
    (capability) => !options.grantedCapabilities.includes(capability)
  )
  if (missingCapabilities.length) throw new Error(`skill_capability_not_granted:${missingCapabilities.join(',')}`)
  if (!isAgentFullAccessEnabled()) throw new Error('skill_script_requires_full_access')
  const backend = getAgentBackend()
  if (backend === 'accessibility') throw new Error('skill_script_unavailable_with_accessibility')
  await verifyScript(options.script.scriptBase64, entrypoint.sha256, entrypoint.size)

  const approved = await requestAgentApproval({
    sessionId: options.sessionId,
    runId: options.sessionId,
    title: `Run Skill script: ${options.skillName}/${entrypoint.name}`,
    detail: JSON.stringify({
      runtime: entrypoint.runtime,
      args,
      workingDirectory: entrypoint.workingDirectory,
      capabilities: entrypoint.capabilities,
      sha256: entrypoint.sha256,
    }),
    risk: 'dangerous',
    signal: options.abortSignal,
  })
  if (!approved) return { success: false, stdout: '', stderr: 'skill_script_approval_denied', exitCode: 126 }

  const executionId = `skill-${crypto.randomUUID()}`
  const nativeOptions = {
    backend,
    skillName: options.skillName,
    entrypointName: entrypoint.name,
    runtime: entrypoint.runtime,
    scriptBase64: options.script.scriptBase64,
    scriptSha256: entrypoint.sha256,
    args,
    workingDirectoryMode: entrypoint.workingDirectory,
    workspaceDirectory: getAgentWorkingDirectory(),
    timeout: entrypoint.timeoutMs,
    executionId,
    signatureVerified: options.signatureVerified,
  }
  const approvalNonce = await requestNativeAuthorization(nativeOptions, options.abortSignal)
  const result = await executeAgentAction({
    toolId: 'skill.script.execute',
    backend,
    parameters: {
      skillName: options.skillName,
      entrypointName: entrypoint.name,
      runtime: entrypoint.runtime,
      scriptSha256: entrypoint.sha256,
      args,
      workingDirectory: entrypoint.workingDirectory,
      capabilities: entrypoint.capabilities,
      executionId,
      signatureVerified: options.signatureVerified,
    },
    taskId: options.sessionId,
    toolCallId: options.toolCallId,
    abortSignal: options.abortSignal,
    deadline: Date.now() + entrypoint.timeoutMs + 5_000,
    sideEffect: true,
    failureState: 'unknown',
    isSuccess: (value) => value.exitCode === 0,
    resultToJson: (value) => ({ exitCode: value.exitCode, timedOut: value.timedOut }),
    execute: () =>
      runAbortable(
        backend === 'shizuku'
          ? yachiyoDeviceAccessNative.execShizukuSkillScript({ ...nativeOptions, approvalNonce })
          : yachiyoAgentNative.execRootSkillScript({ ...nativeOptions, approvalNonce }),
        options.abortSignal,
        executionId
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
