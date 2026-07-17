import { TOOL_IDS, ToolCallRequestSchema } from '@shared/agent'
import { type RootCommandResult, yachiyoAgentNative } from '@/platform/native/yachiyo_agent'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'

const FULL_ACCESS_KEY = 'yachiyo-agent-full-access-v1'
const AUDIT_KEY = 'yachiyo-agent-audit-v1'
const WORKING_DIRECTORY_KEY = 'yachiyo-agent-working-directory-v1'
const BACKEND_KEY = 'yachiyo-agent-backend-v1'
const ROOT_CAPABILITY_KEY = 'yachiyo-agent-root-capability-v1'

export const ANDROID_AGENT_WORKING_DIRECTORY = '/data/local/tmp/yachiyo-agent'
export type AgentBackend = 'root' | 'shizuku' | 'accessibility'
export interface RootCapability {
  available: boolean
  detail: string
}

let rootCapabilityCache: RootCapability | null = null

function readPersistedRootCapability(): RootCapability | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(ROOT_CAPABILITY_KEY) || 'null') as RootCapability | null
    return parsed && typeof parsed.available === 'boolean' && typeof parsed.detail === 'string' ? parsed : null
  } catch {
    return null
  }
}

function persistRootCapability(capability: RootCapability | null): void {
  rootCapabilityCache = capability
  if (typeof localStorage === 'undefined') return
  if (capability) localStorage.setItem(ROOT_CAPABILITY_KEY, JSON.stringify(capability))
  else localStorage.removeItem(ROOT_CAPABILITY_KEY)
}

export function getAgentBackend(): AgentBackend {
  if (typeof localStorage === 'undefined') return 'root'
  const backend = localStorage.getItem(BACKEND_KEY)
  return backend === 'shizuku' || backend === 'accessibility' ? backend : 'root'
}

export function setAgentBackend(backend: AgentBackend): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(BACKEND_KEY, backend)
}

export function getAgentWorkingDirectory(): string {
  if (typeof localStorage === 'undefined') return ANDROID_AGENT_WORKING_DIRECTORY
  const stored = localStorage.getItem(WORKING_DIRECTORY_KEY)?.trim()
  return stored || ANDROID_AGENT_WORKING_DIRECTORY
}

export function setAgentWorkingDirectory(path: string): void {
  const normalized = path.trim().replace(/\/+$/, '')
  if (!normalized.startsWith('/') || /[\0\r\n]/.test(normalized)) {
    throw new Error('invalid_working_directory')
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(WORKING_DIRECTORY_KEY, normalized)
  }
}

interface AgentAuditEntry {
  at: number
  callId: string
  toolId: string
  status: 'success' | 'error' | 'denied'
  exitCode?: number
}

export function isAgentFullAccessEnabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(FULL_ACCESS_KEY) === 'true'
}

export function setAgentFullAccessEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FULL_ACCESS_KEY, String(enabled))
}

function appendAudit(entry: AgentAuditEntry): void {
  if (typeof localStorage === 'undefined') return
  let entries: AgentAuditEntry[] = []
  try {
    entries = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]') as AgentAuditEntry[]
  } catch {
    entries = []
  }
  localStorage.setItem(AUDIT_KEY, JSON.stringify([...entries.slice(-99), entry]))
}

export async function executeRootShell(command: string, timeout = 120_000): Promise<RootCommandResult> {
  const callId = crypto.randomUUID()
  ToolCallRequestSchema.parse({
    schemaVersion: 1,
    taskId: 'android-agent',
    stepId: callId,
    callId,
    attempt: 1,
    toolId: TOOL_IDS.SHELL_EXEC,
    toolVersion: 1,
    deadline: Date.now() + timeout,
    parameters: { command, timeout },
  })

  if (!isAgentFullAccessEnabled()) {
    appendAudit({ at: Date.now(), callId, toolId: TOOL_IDS.SHELL_EXEC, status: 'denied' })
    return { stdout: '', stderr: '完全访问模式未启用', exitCode: 126, timedOut: false }
  }

  try {
    const backend = getAgentBackend()
    if (backend === 'accessibility') {
      return { stdout: '', stderr: '无障碍后端不提供 Shell，请使用设备操作工具', exitCode: 127, timedOut: false }
    }
    const result =
      backend === 'shizuku'
        ? await yachiyoDeviceAccessNative.execShizuku(command, timeout)
        : await yachiyoAgentNative.execRoot(command, timeout)
    appendAudit({
      at: Date.now(),
      callId,
      toolId: TOOL_IDS.SHELL_EXEC,
      status: result.exitCode === 0 ? 'success' : 'error',
      exitCode: result.exitCode,
    })
    return result
  } catch (error) {
    if (getAgentBackend() === 'root') persistRootCapability(null)
    appendAudit({ at: Date.now(), callId, toolId: TOOL_IDS.SHELL_EXEC, status: 'error' })
    throw error
  }
}

export function getCachedRootCapability(): RootCapability | null {
  if (!rootCapabilityCache) rootCapabilityCache = readPersistedRootCapability()
  return rootCapabilityCache
}

export async function getRootCapability(): Promise<RootCapability> {
  const capability = await yachiyoAgentNative.checkRoot()
  persistRootCapability(capability)
  return capability
}

export function clearCachedRootCapability(): void {
  persistRootCapability(null)
}

export async function killRootCommand(): Promise<{ killed: boolean }> {
  return yachiyoAgentNative.kill()
}
