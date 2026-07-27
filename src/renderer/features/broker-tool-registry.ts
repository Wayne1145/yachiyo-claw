import {
  CORE_AGENT_PRINCIPAL,
  TOOL_IDS,
  ToolDescriptorSchema,
  type AgentPrincipal,
  type BackendKind,
  type RiskLevel,
  type ToolDescriptor,
  type ToolId,
} from '@shared/agent'
import type { FeatureTrust } from '@shared/features/contract'
import { isPrivilegedToolId } from '@shared/features/privileged-tools'

export const INTERNAL_BROKER_TOOL_IDS = [
  'sandbox.command.exec',
  'sandbox.command.start_background',
  'sandbox.command.stop_background',
  'sandbox.toolchain.install_android',
  'skill.script.execute',
  'plugin.sandbox.read',
  'plugin.sandbox.write',
  'plugin.sandbox.exec',
  'plugin.network.fetch',
] as const

export type InternalBrokerToolId = (typeof INTERNAL_BROKER_TOOL_IDS)[number]
export type BrokerToolId = ToolId | InternalBrokerToolId | `android.companion.${string}`

interface RegisteredBrokerTool {
  featureId: string
  trust: FeatureTrust
  descriptor: ToolDescriptor
}

const tools = new Map<string, RegisteredBrokerTool>()
let builtinsRegistered = false

function descriptor(
  toolId: BrokerToolId,
  riskLevel: RiskLevel,
  supportedBackends: BackendKind[],
  sideEffect: boolean,
): ToolDescriptor {
  return ToolDescriptorSchema.parse({
    schemaVersion: 1,
    toolId,
    version: 1,
    displayName: toolId,
    description: `Broker policy descriptor for ${toolId}.`,
    parametersSchema: { type: 'object' },
    resultSchema: { type: 'object' },
    modelResultPolicy: { sensitivity: 'private', maxBytes: 8 * 1024, retention: 'task' },
    riskLevel,
    approvalPolicy: sideEffect
      ? { mode: 'prompt', scope: 'parameters', rememberFor: 'task' }
      : { mode: 'none' },
    supportedBackends,
  })
}

export function registerBrokerToolDescriptor(input: RegisteredBrokerTool): void {
  const parsed = ToolDescriptorSchema.parse(input.descriptor)
  if (isPrivilegedToolId(parsed.toolId) && input.trust !== 'privileged') {
    throw new Error('broker_tool_privilege_escalation')
  }
  const current = tools.get(parsed.toolId)
  if (current) {
    if (current.featureId === input.featureId && current.trust === input.trust) return
    throw new Error('broker_tool_already_registered')
  }
  tools.set(parsed.toolId, { ...input, descriptor: parsed })
}

const READ_ONLY_DEVICE_TOOLS = new Set<string>([
  TOOL_IDS.SCREEN_OBSERVE,
  TOOL_IDS.UI_FIND,
  TOOL_IDS.APP_LIST,
  TOOL_IDS.DEVICE_STATUS_READ,
  TOOL_IDS.CLIPBOARD_READ,
  TOOL_IDS.NOTIFICATION_LIST,
  TOOL_IDS.FILE_READ,
  TOOL_IDS.SCHEDULE_LIST,
])

function deviceBackends(toolId: string): BackendKind[] {
  if (toolId === TOOL_IDS.SHELL_EXEC) return ['root', 'shizuku', 'adb']
  return ['accessibility', 'root', 'shizuku', 'adb', 'companion']
}

export function registerBuiltInBrokerTools(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  for (const toolId of Object.values(TOOL_IDS)) {
    const readOnly = READ_ONLY_DEVICE_TOOLS.has(toolId)
    const scheduled = toolId.startsWith('agent.schedule.')
    registerBrokerToolDescriptor({
      featureId: scheduled ? 'tasks' : 'android-device',
      trust: 'privileged',
      descriptor: descriptor(
        toolId,
        readOnly ? 'read' : toolId === TOOL_IDS.SHELL_EXEC ? 'destructive' : 'act',
        scheduled ? ['standard'] : deviceBackends(toolId),
        !readOnly,
      ),
    })
  }
  for (const toolId of INTERNAL_BROKER_TOOL_IDS) {
    const featureId = toolId.startsWith('skill.') ? 'skills' : toolId.startsWith('plugin.') ? 'plugins' : 'sandbox'
    const readOnly = toolId === 'plugin.sandbox.read'
    const backend = toolId === 'plugin.network.fetch' ? 'standard' : 'sandbox'
    registerBrokerToolDescriptor({
      featureId,
      trust: 'sandboxed',
      descriptor: descriptor(toolId, readOnly ? 'read' : 'sensitive', [backend], !readOnly),
    })
  }
}

export function registerCompanionBrokerTool(toolId: `android.companion.${string}`): void {
  registerBuiltInBrokerTools()
  registerBrokerToolDescriptor({
    featureId: 'android-device',
    trust: 'privileged',
    descriptor: descriptor(toolId, 'act', ['companion'], true),
  })
}

export function requireBrokerToolAuthorization(input: {
  featureId: string
  toolId: BrokerToolId
  backend: BackendKind
  principal?: AgentPrincipal
}): ToolDescriptor {
  registerBuiltInBrokerTools()
  const registered = tools.get(input.toolId)
  if (!registered) throw new Error('broker_tool_not_registered')
  if (registered.featureId !== input.featureId) throw new Error('broker_tool_feature_mismatch')
  if (!registered.descriptor.supportedBackends.includes(input.backend)) throw new Error('broker_tool_backend_denied')
  if (isPrivilegedToolId(input.toolId) && registered.trust !== 'privileged') {
    throw new Error('broker_tool_privilege_escalation')
  }
  // Caller identity is audited separately. Third-party device calls are allowed only through the
  // android-device descriptor after Plugin Manager has performed its per-plugin capability grant.
  void (input.principal ?? CORE_AGENT_PRINCIPAL)
  return registered.descriptor
}

export function resetBrokerToolRegistry(): void {
  tools.clear()
  builtinsRegistered = false
}
