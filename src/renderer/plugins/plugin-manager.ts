import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import { AgentPrincipalSchema, TOOL_IDS, type AgentPrincipal, type JsonValue } from '@shared/agent'
import { z } from 'zod'
import { evaluatePluginGrant, type PluginGrant } from '@shared/plugins/grants'
import {
  EMPTY_HEALTH,
  evaluateGrantPreservation,
  isPluginCompatible,
  recordPluginFailure,
  recordPluginSuccess,
  reenablePlugin,
} from '@shared/plugins/lifecycle'
import type { PluginManifest } from '@shared/plugins/manifest'
import { isPluginCapabilityImplemented } from '@shared/plugins/device-policy'
import { parsePluginView, type PluginView } from '@shared/plugins/view-schema'
import { checkWriteWithinQuota, isValidStorageKey, pluginStorageKey, utf8ByteLength } from '@shared/plugins/storage'
import type { PluginSource, VerifiedPluginPackage } from '@shared/plugins/verify'
import platform from '@/platform'
import { appendAgentAudit, digestAgentJson, executeAgentAction, isAgentFullAccessEnabled } from '@/mobile/agent-broker'
import { cancelPendingPluginApprovals, requestAgentAuthorization } from '@/mobile/agent-approval'
import { getAgentSessionConfig } from '@/mobile/agent-session-config'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { yachiyoPluginNetworkNative } from '@/platform/native/yachiyo_plugin_network'
import { type NativeSandboxJob, yachiyoSandboxNative } from '@/platform/native/yachiyo_sandbox'
import {
  capacitorPluginFileStore,
  listInstalledPlugins,
  localforagePluginRegistry,
  pluginDataStore,
  pluginGrantStore,
  pluginHealthStore,
} from './capacitor-stores'
import { createBlobWorkerRuntime } from './blob-worker-runtime'
import {
  assertPluginUpdateProvenance,
  assertPluginVersionUpgrade,
  type InstalledPluginRecord,
  type PluginUpdateSource,
  PluginInstaller,
  pluginInstallDir,
} from './installer'
import { PluginNetworkQuota, pluginFetch } from './network-proxy'
import type { PluginHostCallContext, PluginInvocationContext, PluginRuntime } from './plugin-runtime'
import { PLUGIN_RPC_PROTOCOL_VERSION } from './rpc-protocol'
import { initPluginToolset } from './plugin-toolset'
import { settingsStore } from '@/stores/settingsStore'
import { clearPendingPluginInstall, discardPendingPluginArtifact } from './pending-install'

/**
 * Plugin manager (platform-27/22/23 wiring).
 *
 * Owns the installed-plugin list, per-plugin grants, and the per-plugin Worker runtime. This is the
 * single place a plugin's host call is authorized: `authorize` routes every capability check through
 * `evaluatePluginGrant` (default-deny, digest-bound), and the host API map only ever contains the
 * whitelisted, capability-gated methods below — grants themselves are not reachable from plugins.
 */

const installer = new PluginInstaller(capacitorPluginFileStore, localforagePluginRegistry)

const runtimes = new Map<string, PluginRuntime>()
const runtimeStarts = new Map<string, Promise<{ runtime: PluginRuntime; tools: { name: string }[] }>>()
const startingRuntimes = new Map<string, PluginRuntime>()
const runtimeGenerations = new Map<string, number>()
const networkQuotas = new Map<string, PluginNetworkQuota>()
const sandboxInvocationTimes = new Map<string, number[]>()
let pluginCodeReconciled = false

export function isPluginFeatureEnabled(
  overrides: Readonly<Record<string, boolean>> = settingsStore.getState().featureOverrides ?? {}
): boolean {
  return overrides.plugins !== false
}

const pluginFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
    'invalid_plugin_file_path'
  )
const sandboxExecSchema = z
  .object({
    command: z
      .string()
      .trim()
      .min(1)
      .max(8 * 1024)
      .refine((value) => !value.includes('\0')),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  })
  .strict()
const sandboxReadSchema = z.object({ path: pluginFilePathSchema }).strict()
const sandboxWriteSchema = z.object({ path: pluginFilePathSchema, content: z.string().max(4 * 1024 * 1024) }).strict()
const selectorFields = {
  packageName: z.string().trim().min(1).max(200).optional(),
  resourceId: z.string().trim().min(1).max(300).optional(),
  text: z.string().max(500).optional(),
  contentDescription: z.string().max(500).optional(),
  role: z.string().trim().min(1).max(80).optional(),
  ancestorSignature: z.string().max(500).optional(),
} as const
const hasSelector = (value: Record<string, unknown>) =>
  Object.keys(selectorFields).some((key) => value[key] !== undefined)
const selectorSchema = z.object(selectorFields).strict().refine(hasSelector, 'selector_required')
const deviceMethodSchemas = {
  'device.observe': z.object({}).strict(),
  'device.find': selectorSchema,
  'device.click': selectorSchema,
  'device.setText': z
    .object({ ...selectorFields, value: z.string().max(4_000) })
    .strict()
    .refine(hasSelector, 'selector_required'),
  'device.scroll': z
    .object({
      ...selectorFields,
      direction: z.enum(['up', 'down', 'left', 'right', 'forward', 'backward']),
    })
    .strict()
    .refine(hasSelector, 'selector_required'),
  'device.launch': z
    .object({
      packageName: z
        .string()
        .trim()
        .max(200)
        .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/),
      activityName: z.string().trim().max(300).optional(),
    })
    .strict(),
  'device.keyevent': z.object({ key: z.enum(['BACK', 'HOME', 'RECENTS']) }).strict(),
} as const

function requirePluginPrincipal(
  record: InstalledPluginRecord,
  context: PluginHostCallContext
): Extract<AgentPrincipal, { kind: 'plugin' }> {
  const principal = AgentPrincipalSchema.parse(context.principal)
  const expectedDigest = record.manifest.entrySha256 ?? record.packageSha256
  if (
    principal.kind !== 'plugin' ||
    principal.pluginId !== record.manifest.id ||
    principal.entrySha256 !== expectedDigest
  ) {
    throw new Error('plugin_principal_mismatch')
  }
  return principal
}

function consumeSandboxQuota(pluginId: string): void {
  const now = Date.now()
  const retained = (sandboxInvocationTimes.get(pluginId) ?? []).filter((value) => now - value < 60 * 60_000)
  if (retained.length >= 30) throw new Error('plugin_sandbox_hourly_quota_exceeded')
  retained.push(now)
  sandboxInvocationTimes.set(pluginId, retained)
}

async function waitForPluginSandboxJob(
  jobId: string,
  signal: AbortSignal
): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  const stop = () => void yachiyoSandboxNative.stopJob({ jobId }).catch(() => undefined)
  signal.addEventListener('abort', stop, { once: true })
  try {
    for (;;) {
      if (signal.aborted) throw new Error('plugin_sandbox_cancelled')
      const job: NativeSandboxJob = await yachiyoSandboxNative.queryJob({ jobId })
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)) {
        const output = await yachiyoSandboxNative.readJobOutput({ jobId })
        return {
          stdout: output.stdout,
          stderr: output.stderr,
          exitCode: job.exitCode ?? (job.state === 'succeeded' ? 0 : 1),
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

interface PluginStoreState {
  installed: InstalledPluginRecord[]
  /** Plugins whose host-rendered navigation contributions currently pass every runtime gate. */
  contributionPluginIds: string[]
  /** Pending consent request: verified package waiting for the user's decision. */
  pendingConsent: {
    verified: VerifiedPluginPackage
    bytes: Uint8Array
    preservedCapabilities: string[]
    verification?: Pick<import('@shared/plugins/verify').VerifyPluginPackageInput, 'expectedSha256' | 'signature'>
    updateSource?: PluginUpdateSource
    /** Native artifact retained until the user confirms or cancels installation. */
    artifactId?: string
  } | null
  refresh(): Promise<void>
  /** Step 1: verify a package and surface the consent sheet. Throws PluginInstallError on bad packages. */
  requestInstall(
    bytes: Uint8Array,
    source: PluginSource,
    metadata?: Pick<import('@shared/plugins/verify').VerifyPluginPackageInput, 'expectedSha256' | 'signature'> & {
      updateSource?: PluginUpdateSource
      artifactId?: string
      expectedPlugin?: { id: string; version?: string }
    }
  ): Promise<void>
  /** Step 2a: user approved — install, persist granted capabilities, refresh. */
  confirmInstall(grantedCapabilities: string[]): Promise<void>
  /** Step 2b: user declined — nothing was written; drop the pending state. */
  cancelInstall(): Promise<void>
  uninstall(pluginId: string): Promise<void>
  setEnabled(pluginId: string, enabled: boolean): Promise<void>
  rollback(pluginId: string, version?: string): Promise<void>
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  installed: [],
  contributionPluginIds: [],
  pendingConsent: null,

  async refresh() {
    if (!pluginCodeReconciled) {
      try {
        await installer.cleanupAbandonedCode()
        pluginCodeReconciled = true
      } catch {
        // Leave the flag clear so a transient filesystem failure is retried on the next refresh.
      }
    }
    const installed = await listInstalledPlugins()
    // Reading each decision performs the one-time Keystore migration for pre-plugin-platform builds.
    await Promise.all(
      installed.flatMap((record) =>
        record.manifest.capabilities.map((capability) => pluginGrantStore.get(record.manifest.id, capability.name))
      )
    )
    const appVersion = await platform.getVersion().catch(() => '0.0.0')
    const contributionPluginIds: string[] = []
    for (const record of installed) {
      if (record.enabled === false || !isPluginCompatible(record.manifest, appVersion)) continue
      const health = await pluginHealthStore.get(record.manifest.id)
      if (health?.disabledReason) continue
      const hasUiContribution = Boolean(
        record.manifest.contributions.view ||
          record.manifest.contributions.tab ||
          record.manifest.contributions.settingsEntries?.length,
      )
      if (!hasUiContribution) continue
      const grant = await pluginGrantStore.get(record.manifest.id, 'ui')
      const boundSha = record.manifest.entrySha256 ?? record.packageSha256
      if (
        evaluatePluginGrant(grant, {
          pluginId: record.manifest.id,
          capability: 'ui',
          currentEntrySha256: boundSha,
          now: Date.now(),
        }).allowed
      ) contributionPluginIds.push(record.manifest.id)
    }
    set({ installed, contributionPluginIds })
  },

  async requestInstall(bytes, source, metadata) {
    const { updateSource, artifactId, expectedPlugin, ...verification } = metadata ?? {}
    const verified = await installer.inspect({ packageBytes: bytes, source, ...verification })
    if (
      expectedPlugin &&
      (verified.manifest.id !== expectedPlugin.id ||
        (expectedPlugin.version !== undefined && verified.manifest.version !== expectedPlugin.version))
    ) {
      throw new Error('plugin_update_identity_mismatch')
    }
    const existing = await localforagePluginRegistry.get(verified.manifest.id)
    if (existing) {
      assertPluginUpdateProvenance(existing, verified)
      assertPluginVersionUpgrade(existing, verified.manifest)
    }
    const preservedCapabilities: string[] = []
    if (existing) {
      const preservation = evaluateGrantPreservation({
        oldManifest: existing.manifest,
        newManifest: verified.manifest,
        oldSignerKeyId: existing.signerKeyId,
        newSignerKeyId: verified.signerKeyId,
      })
      const oldSha = existing.manifest.entrySha256 ?? existing.packageSha256
      for (const capability of verified.manifest.capabilities) {
        if (preservation[capability.name] !== 'preserve') continue
        const grant = await pluginGrantStore.get(existing.manifest.id, capability.name)
        const host = capability.name === 'network' ? capability.domains?.[0] : undefined
        if (
          evaluatePluginGrant(grant, {
            pluginId: existing.manifest.id,
            capability: capability.name,
            currentEntrySha256: oldSha,
            now: Date.now(),
            host,
          }).allowed
        ) {
          preservedCapabilities.push(capability.name)
        }
      }
    }
    set({ pendingConsent: { verified, bytes, preservedCapabilities, verification, updateSource, artifactId } })
  },

  async confirmInstall(grantedCapabilities) {
    const pending = get().pendingConsent
    if (!pending) return
    const pluginId = pending.verified.manifest.id
    const existing = await localforagePluginRegistry.get(pluginId)
    const previousGrants = new Map<string, PluginGrant | null>()
    for (const capability of existing?.manifest.capabilities ?? []) {
      previousGrants.set(capability.name, await pluginGrantStore.get(pluginId, capability.name))
    }
    const record = await installer.install({
      packageBytes: pending.bytes,
      source: pending.verified.source,
      ...pending.verification,
      ...(pending.updateSource ? { updateSource: pending.updateSource } : {}),
    })
    const now = Date.now()
    const boundSha = record.manifest.entrySha256 ?? record.packageSha256
    try {
      // Grants are an exact projection of the active manifest. Clearing first also removes stale
      // rows left by interrupted updates or older versions that reused the same entry digest.
      await pluginGrantStore.removeAll(pluginId)
      for (const capability of record.manifest.capabilities) {
        // Device control always requires a second explicit action after installation.
        const canGrant =
          capability.name !== 'device' &&
          isPluginCapabilityImplemented(capability.name) &&
          grantedCapabilities.includes(capability.name)
        const grant: PluginGrant = {
          schemaVersion: 1,
          pluginId: record.manifest.id,
          capability: capability.name,
          state: canGrant ? 'granted' : 'denied',
          boundEntrySha256: boundSha,
          decidedAt: now,
          expiresAt: null,
          ...(capability.name === 'network' && capability.domains ? { domains: capability.domains } : {}),
        }
        await pluginGrantStore.put(grant)
      }
    } catch (error) {
      // Keystore persistence is part of the install transaction. Restore both active code and grants.
      if (existing) await installer.restoreAfterFailedUpdate(existing).catch(() => {})
      else await installer.uninstall(pluginId).catch(() => {})
      await pluginGrantStore.removeAll(pluginId).catch(() => {})
      for (const [capability, grant] of previousGrants) {
        if (grant) await pluginGrantStore.put(grant).catch(() => {})
        else await pluginGrantStore.remove(pluginId, capability).catch(() => {})
      }
      throw error
    }
    disposePluginRuntime(pluginId)
    set({ pendingConsent: null })
    clearPendingPluginInstall(pending.artifactId)
    await discardPendingPluginArtifact(pending.artifactId)
    await get().refresh()
  },

  async cancelInstall() {
    const artifactId = get().pendingConsent?.artifactId
    set({ pendingConsent: null })
    clearPendingPluginInstall(artifactId)
    await discardPendingPluginArtifact(artifactId)
  },

  async uninstall(pluginId) {
    // Complete cleanup checklist (plat-29): idempotent, continue-on-failure — a partial failure keeps
    // cleaning the rest and reports a summary instead of leaving residue. Audit records are KEPT.
    const failures: string[] = []
    const step = async (label: string, action: () => Promise<unknown> | void) => {
      try {
        await action()
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : 'failed'}`)
      }
    }
    await step('runtime', () => disposePluginRuntime(pluginId)) // running worker terminated
    await step('pending approvals', () => cancelPendingPluginApprovals(pluginId))
    if (Capacitor.isNativePlatform()) {
      await step('sandbox workspace', () => yachiyoSandboxNative.cleanupPlugin({ pluginId }))
    }
    await step('registry+code', () => installer.uninstall(pluginId)) // record + code directory (all versions)
    await step('grants', () => pluginGrantStore.removeAll(pluginId))
    await step('data', () => pluginDataStore.removeAll(`plugin:${pluginId}:`))
    await step('health', () => pluginHealthStore.remove(pluginId))
    networkQuotas.delete(pluginId)
    sandboxInvocationTimes.delete(pluginId)
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: failures.length > 0 ? 'uninstall_incomplete' : 'uninstalled',
      status: failures.length > 0 ? 'error' : 'ok',
      failures,
    })
    await get().refresh()
    if (failures.length > 0) throw new Error(`plugin_uninstall_incomplete: ${failures.join('; ')}`)
  },

  async setEnabled(pluginId, enabled) {
    const record = await localforagePluginRegistry.get(pluginId)
    if (!record) return
    await localforagePluginRegistry.put({ ...record, enabled })
    disposePluginRuntime(pluginId)
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: enabled ? 'enabled' : 'disabled',
    })
    await get().refresh()
  },

  async rollback(pluginId, version) {
    disposePluginRuntime(pluginId)
    const record = await installer.rollback(pluginId, version)
    const boundSha = record.manifest.entrySha256 ?? record.packageSha256
    // A rollback changes the active code identity. Rebuild the grant set as revoked so a capability
    // removed by the target manifest cannot survive via an old digest-bound row.
    await pluginGrantStore.removeAll(pluginId)
    for (const capability of record.manifest.capabilities) {
      await pluginGrantStore.put({
        schemaVersion: 1,
        pluginId,
        capability: capability.name,
        state: 'revoked',
        boundEntrySha256: boundSha,
        decidedAt: Date.now(),
        expiresAt: null,
        ...(capability.name === 'network' && capability.domains ? { domains: capability.domains } : {}),
      })
    }
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'rollback',
      version: record.manifest.version,
    })
    await get().refresh()
  },
}))

async function evaluateHostCallAuthorization(
  record: InstalledPluginRecord,
  method: string,
  args: JsonValue,
  context: PluginHostCallContext
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!isPluginFeatureEnabled()) return { allowed: false, reason: 'plugin_feature_disabled' }
  const capability = method.startsWith('storage.')
    ? 'storage'
    : method.startsWith('network.')
      ? 'network'
      : method.startsWith('sandbox.')
        ? 'sandbox'
        : method.startsWith('device.')
          ? 'device'
          : null
  if (!capability) return { allowed: false, reason: 'method_not_found' }
  if (!record.manifest.capabilities.some((entry) => entry.name === capability)) {
    return { allowed: false, reason: 'capability_not_declared' }
  }
  if (!isPluginCapabilityImplemented(capability)) {
    return { allowed: false, reason: 'capability_not_implemented' }
  }
  try {
    requirePluginPrincipal(record, context)
  } catch {
    return { allowed: false, reason: 'plugin_principal_mismatch' }
  }
  if ((capability === 'sandbox' || capability === 'device') && !Capacitor.isNativePlatform()) {
    return { allowed: false, reason: 'capability_requires_android' }
  }
  if ((capability === 'sandbox' || capability === 'device') && !context.sessionId) {
    return { allowed: false, reason: `${capability}_session_required` }
  }
  if (capability === 'device') {
    if (!record.deviceGrantAllowed) return { allowed: false, reason: 'device_requires_trusted_signature' }
    if (!context.sessionId) return { allowed: false, reason: 'device_session_required' }
    const session = getAgentSessionConfig(context.sessionId)
    if (!session.enabled || !session.deviceControlEnabled || !isAgentFullAccessEnabled()) {
      return { allowed: false, reason: 'device_control_disabled' }
    }
  }
  const grant = await pluginGrantStore.get(record.manifest.id, capability)
  const boundSha = record.manifest.entrySha256 ?? record.packageSha256
  let host: string | undefined
  if (capability === 'network') {
    const url = (args as { url?: unknown } | null)?.url
    if (typeof url !== 'string') return { allowed: false, reason: 'invalid_url' }
    try {
      host = new URL(url).hostname
    } catch {
      return { allowed: false, reason: 'invalid_url' }
    }
  }
  const decision = evaluatePluginGrant(grant, {
    pluginId: record.manifest.id,
    capability,
    currentEntrySha256: boundSha,
    now: Date.now(),
    host,
  })
  return decision.allowed ? { allowed: true } : { allowed: false, reason: `capability_denied:${decision.reason}` }
}

async function authorizeHostCall(
  record: InstalledPluginRecord,
  method: string,
  args: JsonValue,
  context: PluginHostCallContext
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const decision = await evaluateHostCallAuthorization(record, method, args, context)
  if (!decision.allowed) {
    appendPluginAudit({
      at: Date.now(),
      principal: {
        kind: 'plugin',
        pluginId: record.manifest.id,
        entrySha256: record.manifest.entrySha256 ?? record.packageSha256,
      },
      event: 'capability_denied',
      method: method.slice(0, 120),
      reason: decision.reason.slice(0, 160),
    })
  }
  return decision
}

function pluginCallId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`
  } catch {
    return `${prefix}-${Date.now().toString(36)}`
  }
}

async function pluginBrokerCheckpoint(
  record: InstalledPluginRecord,
  method: string,
  context: PluginHostCallContext
): Promise<Pick<PluginInvocationContext, 'toolCallId'> & { callId?: string; stepId?: string }> {
  if (!context.toolCallId) return {}
  const digest = await digestAgentJson({
    pluginId: record.manifest.id,
    entrySha256: record.manifest.entrySha256 ?? record.packageSha256,
    toolCallId: context.toolCallId,
    hostCallId: context.hostCallId,
    method,
  })
  const checkpointId = `plugin-${digest}`
  return { toolCallId: context.toolCallId, callId: checkpointId, stepId: checkpointId }
}

async function recordDeniedPluginAction(
  principal: Extract<AgentPrincipal, { kind: 'plugin' }>,
  toolId: string,
  backend: 'sandbox' | 'accessibility' | 'standard',
  parameters: JsonValue,
  errorCode: string
): Promise<void> {
  appendAgentAudit({
    at: Date.now(),
    callId: pluginCallId('plugin-denied'),
    toolId,
    principal,
    backend,
    parameterDigest: await digestAgentJson(parameters),
    approvalDecision: 'deny',
    status: 'denied',
    errorCode,
  })
}

function boundedHostText(value: string, maxBytes = 256 * 1024): string {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength <= maxBytes) return value
  return `${new TextDecoder().decode(bytes.slice(0, maxBytes))}\n[output truncated]`
}

async function executePluginSandboxHostCall(
  record: InstalledPluginRecord,
  method: string,
  rawArgs: JsonValue,
  context: PluginHostCallContext
): Promise<JsonValue> {
  const principal = requirePluginPrincipal(record, context)
  if (!context.sessionId) throw new Error('sandbox_session_required')
  const taskId = context.runId || context.sessionId || `plugin-${record.manifest.id}`
  const checkpoint = await pluginBrokerCheckpoint(record, method, context)

  if (method === 'sandbox.readFile') {
    const args = sandboxReadSchema.parse(rawArgs)
    const result = await executeAgentAction({
      featureId: 'plugins',
      principal,
      toolId: 'plugin.sandbox.read',
      backend: 'sandbox',
      parameters: args,
      taskId,
      ...checkpoint,
      abortSignal: context.signal,
      sideEffect: false,
      isSuccess: (value) => value.success,
      execute: () => yachiyoSandboxNative.readPluginFile({ pluginId: record.manifest.id, filePath: args.path }),
    })
    if (!result.success) throw new Error(result.error || 'plugin_sandbox_read_failed')
    return { content: boundedHostText(result.content ?? '', 512 * 1024) }
  }

  const approvalTitle = `插件 ${record.manifest.displayName} 请求使用 Linux 开发环境`
  if (method === 'sandbox.writeFile') {
    const args = sandboxWriteSchema.parse(rawArgs)
    const authorization = await requestAgentAuthorization({
      principal,
      sessionId: context.sessionId,
      runId: context.runId,
      title: approvalTitle,
      detail: `写入插件私有文件: ${args.path}`,
      risk: 'dangerous',
      signal: context.signal,
      rememberConversationApproval: false,
    })
    if (authorization.decision === 'deny') {
      await recordDeniedPluginAction(principal, 'plugin.sandbox.write', 'sandbox', args, 'user_denied')
      throw new Error('plugin_sandbox_user_denied')
    }
    const result = await executeAgentAction({
      featureId: 'plugins',
      principal,
      toolId: 'plugin.sandbox.write',
      backend: 'sandbox',
      parameters: args,
      taskId,
      ...checkpoint,
      abortSignal: context.signal,
      approvalDecision: authorization.decision,
      sideEffect: true,
      isSuccess: (value) => value.success,
      execute: () =>
        yachiyoSandboxNative.writePluginFile({
          pluginId: record.manifest.id,
          filePath: args.path,
          content: args.content,
        }),
    })
    if (!result.success) throw new Error(result.error || 'plugin_sandbox_write_failed')
    return { ok: true }
  }

  if (method !== 'sandbox.exec') throw new Error('method_not_found')
  const args = sandboxExecSchema.parse(rawArgs)
  consumeSandboxQuota(record.manifest.id)
  const authorization = await requestAgentAuthorization({
    principal,
    sessionId: context.sessionId,
    runId: context.runId,
    title: approvalTitle,
    detail: `命令将在插件独立工作区运行。PRoot 不是安全隔离边界，命令仍可联网并修改共享 Linux 根文件系统。\n\n${args.command.slice(0, 4_000)}`,
    risk: 'dangerous',
    signal: context.signal,
    rememberConversationApproval: false,
  })
  if (authorization.decision === 'deny') {
    await recordDeniedPluginAction(principal, 'plugin.sandbox.exec', 'sandbox', args, 'user_denied')
    throw new Error('plugin_sandbox_user_denied')
  }
  let jobId = ''
  const result = await executeAgentAction({
    featureId: 'plugins',
    principal,
    toolId: 'plugin.sandbox.exec',
    backend: 'sandbox',
    parameters: args,
    taskId,
    ...checkpoint,
    abortSignal: context.signal,
    approvalDecision: authorization.decision,
    deadline: Date.now() + (args.timeoutMs ?? 30_000) + 10_000,
    sideEffect: true,
    isSuccess: (value) => value.exitCode === 0,
    resultToJson: (value) => ({ exitCode: value.exitCode }),
    onAbort: async () => {
      if (jobId) await yachiyoSandboxNative.stopJob({ jobId }).catch(() => undefined)
    },
    execute: async () => {
      const started = await yachiyoSandboxNative.startPluginJob({
        pluginId: record.manifest.id,
        command: args.command,
        timeout: args.timeoutMs ?? 30_000,
      })
      if (!started.accepted) throw new Error('plugin_sandbox_start_failed')
      jobId = started.jobId
      return waitForPluginSandboxJob(jobId, context.signal)
    },
  })
  return {
    stdout: boundedHostText(result.stdout),
    stderr: boundedHostText(result.stderr),
    exitCode: result.exitCode,
  }
}

async function executePluginDeviceHostCall(
  record: InstalledPluginRecord,
  method: keyof typeof deviceMethodSchemas,
  rawArgs: JsonValue,
  context: PluginHostCallContext
): Promise<JsonValue> {
  const principal = requirePluginPrincipal(record, context)
  if (!context.sessionId) throw new Error('device_session_required')
  const parsed = deviceMethodSchemas[method].parse(rawArgs) as Record<string, unknown>
  const taskId = context.runId || context.sessionId || `plugin-${record.manifest.id}`
  const checkpoint = await pluginBrokerCheckpoint(record, method, context)
  const parameters = { method, arguments: parsed } as JsonValue
  const readOnly = method === 'device.observe' || method === 'device.find'
  const toolId =
    method === 'device.observe'
      ? TOOL_IDS.SCREEN_OBSERVE
      : method === 'device.find'
        ? TOOL_IDS.UI_FIND
        : method === 'device.setText'
          ? TOOL_IDS.UI_TYPE_TEXT
          : method === 'device.scroll'
            ? TOOL_IDS.UI_SWIPE
            : method === 'device.launch'
              ? TOOL_IDS.APP_LAUNCH
              : method === 'device.keyevent'
                ? parsed.key === 'HOME'
                  ? TOOL_IDS.NAVIGATION_HOME
                  : parsed.key === 'RECENTS'
                    ? TOOL_IDS.NAVIGATION_RECENTS
                    : TOOL_IDS.NAVIGATION_BACK
                : TOOL_IDS.UI_TAP

  let approvalDecision: 'once' | 'conversation' | 'not-required' = 'not-required'
  let approvalNonce = ''
  let approvalDigest = ''
  if (!readOnly) {
    approvalDigest = await digestAgentJson({ principal, method, arguments: parsed } as JsonValue)
    const authorization = await requestAgentAuthorization({
      principal,
      sessionId: context.sessionId,
      runId: context.runId,
      title: `插件 ${record.manifest.displayName} 请求操作手机`,
      detail: `${method}\n${JSON.stringify(parsed, null, 2).slice(0, 3_500)}`,
      risk: 'dangerous',
      signal: context.signal,
      rememberConversationApproval: false,
      bindingDigest: approvalDigest,
    })
    if (authorization.decision === 'deny' || !authorization.approvalNonce) {
      await recordDeniedPluginAction(principal, toolId, 'accessibility', parameters, 'user_denied')
      throw new Error('plugin_device_user_denied')
    }
    approvalDecision = authorization.decision
    approvalNonce = authorization.approvalNonce
  }

  const result = await executeAgentAction({
    featureId: 'android-device',
    principal,
    toolId,
    backend: 'accessibility',
    parameters,
    taskId,
    ...checkpoint,
    abortSignal: context.signal,
    approvalDecision,
    sideEffect: !readOnly,
    failureState: readOnly ? 'not_started' : 'unknown',
    isSuccess: (value) => value.success,
    execute: async () => {
      const approval = readOnly
        ? {}
        : {
            approvalRequired: true,
            approvalNonce,
            approvalDigest,
          }
      switch (method) {
        case 'device.observe':
          return yachiyoDeviceAccessNative.accessibilityAction({ action: 'observeSemantic' })
        case 'device.find':
          return yachiyoDeviceAccessNative.accessibilityAction({ action: 'findNode', ...parsed })
        case 'device.click':
          return yachiyoDeviceAccessNative.accessibilityAction({ action: 'clickNode', ...parsed, ...approval })
        case 'device.setText': {
          const { value, text, ...selector } = parsed
          return yachiyoDeviceAccessNative.accessibilityAction({
            action: 'setNodeText',
            ...selector,
            selectorText: typeof text === 'string' ? text : undefined,
            text: String(value ?? ''),
            ...approval,
          })
        }
        case 'device.scroll':
          return yachiyoDeviceAccessNative.accessibilityAction({ action: 'scrollNode', ...parsed, ...approval })
        case 'device.launch':
          return yachiyoDeviceAccessNative.launchAppBound({
            packageName: String(parsed.packageName),
            activityName: typeof parsed.activityName === 'string' ? parsed.activityName : undefined,
            approvalNonce,
            approvalDigest,
          })
        case 'device.keyevent':
          return yachiyoDeviceAccessNative.accessibilityAction({
            action: 'global',
            key: String(parsed.key),
            ...approval,
          })
      }
    },
  })
  return result as unknown as JsonValue
}

function buildHostApi(record: InstalledPluginRecord) {
  const pluginId = record.manifest.id
  return {
    'storage.get': async (args: unknown) => {
      const key = (args as { key?: string })?.key
      if (!isValidStorageKey(key)) throw new Error('invalid_key')
      return (await pluginDataStore.get(pluginStorageKey(pluginId, key))) ?? null
    },
    'storage.set': async (args: unknown) => {
      const { key, value } = (args as { key?: string; value?: string }) ?? {}
      if (!isValidStorageKey(key) || typeof value !== 'string') throw new Error('invalid_key_or_value')
      const storageKey = pluginStorageKey(pluginId, key)
      const valueBytes = utf8ByteLength(value)
      const current = await pluginDataStore.get(storageKey)
      const pluginBytes = await pluginDataStore.usedBytes(`plugin:${pluginId}:`)
      const totalBytes = await pluginDataStore.usedBytes('plugin:')
      const quota = checkWriteWithinQuota(valueBytes, {
        currentKeyBytes: current ? utf8ByteLength(current) : 0,
        pluginBytes,
        totalBytes,
      })
      if (!quota.ok) throw new Error(quota.reason)
      await pluginDataStore.set(storageKey, value)
      return { ok: true }
    },
    'storage.remove': async (args: unknown) => {
      const key = (args as { key?: string })?.key
      if (!isValidStorageKey(key)) throw new Error('invalid_key')
      await pluginDataStore.remove(pluginStorageKey(pluginId, key))
      return { ok: true }
    },
    'storage.keys': async () => {
      const prefix = `plugin:${pluginId}:`
      const keys = await pluginDataStore.keys(prefix)
      return { keys: keys.map((key) => key.slice(prefix.length)).slice(0, 1_000) }
    },
    'network.fetch': async (args: unknown, context: PluginHostCallContext) => {
      // The grant's exact domain list is the sole egress boundary; the proxy validates every hop.
      const grant = await pluginGrantStore.get(pluginId, 'network')
      const domains = grant?.state === 'granted' ? (grant.domains ?? []) : []
      const request = (args ?? {}) as { url?: string; method?: string; headers?: Record<string, string>; body?: string }
      if (typeof request.url !== 'string') throw new Error('invalid_url')
      if (request.body !== undefined && typeof request.body !== 'string') throw new Error('body_must_be_string')
      const principal = requirePluginPrincipal(record, context)
      let url: string
      try {
        url = new URL(request.url).toString()
      } catch {
        throw new Error('invalid_url')
      }
      const method = (request.method ?? 'GET').trim().toUpperCase()
      if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(method)) throw new Error('method_not_allowed')
      const bodyBytes = typeof request.body === 'string' ? new TextEncoder().encode(request.body).byteLength : 0
      const bodyDigest = await digestAgentJson({ body: request.body ?? null })
      const parameters = {
        url,
        method,
        headerNames: Object.keys(request.headers ?? {}).map((name) => name.toLowerCase()).sort(),
        bodyBytes,
        bodyDigest,
      } as JsonValue
      const mutating = method !== 'GET' && method !== 'HEAD'
      let approvalDecision: 'once' | 'conversation' | 'not-required' = 'not-required'
      if (mutating) {
        const bindingDigest = await digestAgentJson(parameters)
        const authorization = await requestAgentAuthorization({
          principal,
          sessionId: context.sessionId,
          runId: context.runId,
          title: `插件 ${record.manifest.displayName} 请求发送数据`,
          detail: `${method} ${url}\nBody: ${bodyBytes} bytes (${bodyDigest.slice(0, 12)}...)`,
          risk: 'dangerous',
          signal: context.signal,
          rememberConversationApproval: false,
          bindingDigest,
        })
        if (authorization.decision === 'deny') {
          await recordDeniedPluginAction(principal, 'plugin.network.fetch', 'standard', parameters, 'user_denied')
          throw new Error('plugin_network_user_denied')
        }
        approvalDecision = authorization.decision
      }
      const quota =
        networkQuotas.get(pluginId) ??
        (() => {
          const created = new PluginNetworkQuota()
          networkQuotas.set(pluginId, created)
          return created
        })()
      const nativeRequest = { url, method, headers: request.headers, body: request.body }
      const checkpoint = await pluginBrokerCheckpoint(record, 'network.fetch', context)
      const response = await executeAgentAction({
        featureId: 'plugins',
        principal,
        toolId: 'plugin.network.fetch',
        backend: 'standard',
        parameters,
        taskId: context.runId || context.sessionId || `plugin-${pluginId}`,
        ...checkpoint,
        abortSignal: context.signal,
        approvalDecision,
        sideEffect: mutating,
        isSuccess: () => true,
        resultToJson: (result) => ({ status: result.status, finalUrl: result.finalUrl }),
        execute: async () =>
          Capacitor.isNativePlatform()
            ? await (async () => {
                quota.beforeRequest()
                const requestId = pluginCallId('plugin-network')
                const cancel = () => void yachiyoPluginNetworkNative.cancel({ requestId }).catch(() => undefined)
                context.signal.addEventListener('abort', cancel, { once: true })
                try {
                  if (context.signal.aborted) throw new Error('plugin_network_cancelled')
                  const result = await yachiyoPluginNetworkNative.fetch({
                    ...nativeRequest,
                    allowedDomains: domains,
                    requestId,
                  })
                  quota.recordResponse(new TextEncoder().encode(result.body).byteLength)
                  return result
                } finally {
                  context.signal.removeEventListener('abort', cancel)
                }
              })()
            : await pluginFetch(nativeRequest, domains, fetch, quota, { signal: context.signal }),
      })
      appendPluginAudit({
        at: Date.now(),
        principal: {
          kind: 'plugin',
          pluginId,
          entrySha256: record.manifest.entrySha256 ?? record.packageSha256,
        },
        event: 'network_request',
        method,
        status: 'ok',
      })
      return response as unknown as JsonValue
    },
    'sandbox.exec': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginSandboxHostCall(record, 'sandbox.exec', args, context),
    'sandbox.readFile': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginSandboxHostCall(record, 'sandbox.readFile', args, context),
    'sandbox.writeFile': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginSandboxHostCall(record, 'sandbox.writeFile', args, context),
    'device.observe': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.observe', args, context),
    'device.find': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.find', args, context),
    'device.click': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.click', args, context),
    'device.setText': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.setText', args, context),
    'device.scroll': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.scroll', args, context),
    'device.launch': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.launch', args, context),
    'device.keyevent': (args: JsonValue, context: PluginHostCallContext) =>
      executePluginDeviceHostCall(record, 'device.keyevent', args, context),
  }
}

export interface LoadedPlugin {
  record: InstalledPluginRecord
  runtime: PluginRuntime | null
  tools: { name: string }[]
  uiGranted: boolean
  view: PluginView | null
}

export interface LoadPluginForPageOptions {
  startRuntime?: boolean
}

async function assertPluginRunnable(record: InstalledPluginRecord): Promise<void> {
  if (!isPluginFeatureEnabled()) throw new Error('plugin_feature_disabled')
  if (record.enabled === false) throw new Error('plugin_disabled_by_user')
  if (!isPluginCompatible(record.manifest, await platform.getVersion().catch(() => '0.0.0'))) {
    throw new Error('plugin_incompatible_app_version')
  }
  const health = await pluginHealthStore.get(record.manifest.id)
  if (health?.disabledReason) throw new Error(`plugin_disabled:${health.disabledReason}`)
}

/**
 * Loads a plugin for its page: checks health/compatibility gates and the ui grant, and for scripted
 * plugins boots (or reuses) the Worker runtime with the entry read back from disk and re-checked
 * against entrySha256 — installed bytes are not implicitly trusted at load time either.
 */
export async function loadPluginForPage(
  pluginId: string,
  options: LoadPluginForPageOptions = {}
): Promise<LoadedPlugin | null> {
  const record = await localforagePluginRegistry.get(pluginId)
  if (!record) return null
  // The page and Agent paths share this exact gate; neither may revive an incompatible/disabled plugin.
  await assertPluginRunnable(record)

  const boundSha = record.manifest.entrySha256 ?? record.packageSha256
  const uiGrant = await pluginGrantStore.get(pluginId, 'ui')
  const uiGranted = evaluatePluginGrant(uiGrant, {
    pluginId,
    capability: 'ui',
    currentEntrySha256: boundSha,
    now: Date.now(),
  }).allowed

  const view = uiGranted ? await loadBundledPluginView(record) : null
  if (!record.manifest.entry || options.startRuntime === false) {
    return { record, runtime: null, tools: [], uiGranted, view }
  }
  const { runtime, tools } = await ensurePluginRuntime(record)
  return { record, runtime, tools, uiGranted, view }
}

async function loadBundledPluginView(record: InstalledPluginRecord): Promise<PluginView | null> {
  const path = record.manifest.contributions.view
  if (!path) return null
  const declared = record.manifest.files.find((file) => file.path === path)
  if (!declared?.sha256) throw new Error('plugin_view_digest_missing')
  const bytes = await capacitorPluginFileStore.readFile(`${pluginInstallDir(record)}/${path}`)
  const { sha256Hex } = await import('@shared/skills/skillhub')
  if ((await sha256Hex(bytes)) !== declared.sha256.toLowerCase()) throw new Error('plugin_view_digest_mismatch')
  try {
    return parsePluginView(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    throw new Error('plugin_view_invalid')
  }
}

async function notePluginFailure(pluginId: string, kind: 'error' | 'timeout', message: string): Promise<void> {
  const current = (await pluginHealthStore.get(pluginId)) ?? EMPTY_HEALTH
  const updated = recordPluginFailure(current, kind, message)
  await pluginHealthStore.put(pluginId, updated)
  if (updated.disabledReason) disposePluginRuntime(pluginId)
}

async function notePluginSuccess(pluginId: string): Promise<void> {
  const current = await pluginHealthStore.get(pluginId)
  if (current && current.consecutiveFailures > 0) await pluginHealthStore.put(pluginId, recordPluginSuccess(current))
}

/** Explicit user action from the management UI; the only way out of auto-disable. */
export async function reenableDisabledPlugin(pluginId: string): Promise<void> {
  const current = await pluginHealthStore.get(pluginId)
  if (current) await pluginHealthStore.put(pluginId, reenablePlugin(current))
}

/** Boots (or reuses) the plugin's isolate. Entry digest re-checked on every cold boot. */
async function ensurePluginRuntime(
  record: InstalledPluginRecord
): Promise<{ runtime: PluginRuntime; tools: { name: string }[] }> {
  const pluginId = record.manifest.id
  await assertPluginRunnable(record)
  const existing = runtimes.get(pluginId)
  if (existing && !existing.isDisposed()) return { runtime: existing, tools: existing.getRegisteredTools() }
  if (existing) runtimes.delete(pluginId)

  const pending = runtimeStarts.get(pluginId)
  if (pending) return pending

  const generation = runtimeGenerations.get(pluginId) ?? 0
  const start = bootPluginRuntime(record, generation)
  runtimeStarts.set(pluginId, start)
  try {
    return await start
  } finally {
    if (runtimeStarts.get(pluginId) === start) runtimeStarts.delete(pluginId)
  }
}

async function bootPluginRuntime(
  record: InstalledPluginRecord,
  generation: number
): Promise<{ runtime: PluginRuntime; tools: { name: string }[] }> {
  const pluginId = record.manifest.id

  if (!record.manifest.entry) throw new Error('plugin_has_no_entry')
  const entryBytes = await capacitorPluginFileStore.readFile(`${pluginInstallDir(record)}/${record.manifest.entry}`)
  const { sha256Hex } = await import('@shared/skills/skillhub')
  if (record.manifest.entrySha256 && (await sha256Hex(entryBytes)) !== record.manifest.entrySha256.toLowerCase()) {
    throw new Error('entry_digest_mismatch')
  }
  if ((runtimeGenerations.get(pluginId) ?? 0) !== generation) throw new Error('plugin_runtime_start_cancelled')
  const runtime = createBlobWorkerRuntime({
    hostApi: buildHostApi(record),
    // Grants are evaluated for every call so revocation and network host checks take effect immediately.
    authorize: (method, args, context) => authorizeHostCall(record, method, args, context),
    defaultTimeoutMs: 10_000,
    loadTimeoutMs: 10_000,
    idleTimeoutMs: 2 * 60_000,
    maxConcurrentInvocations: 1,
    onIdle: () => {
      if (runtimes.get(pluginId) === runtime) runtimes.delete(pluginId)
    },
    onLog: ({ level, message }) => {
      appendPluginAudit({
        at: Date.now(),
        principal: { kind: 'plugin', pluginId, entrySha256: record.manifest.entrySha256 ?? record.packageSha256 },
        event: 'log',
        level,
        message,
      })
    },
    onWorkerError: (message) => {
      // Plugin exceptions stay plugin-scoped: recorded to plugin health + local audit, never
      // rethrown into the host's global error handling (the app's crash reporter is a no-op, and
      // this keeps it that way for plugin errors by construction).
      void notePluginFailure(pluginId, 'error', message)
      appendPluginAudit({
        at: Date.now(),
        principal: { kind: 'plugin', pluginId },
        event: 'worker_error',
        message: message.slice(0, 300),
      })
      disposePluginRuntime(pluginId)
    },
  })
  startingRuntimes.set(pluginId, runtime)
  try {
    const tools = await runtime.load(pluginId, new TextDecoder().decode(entryBytes))
    if ((runtimeGenerations.get(pluginId) ?? 0) !== generation || runtime.isDisposed()) {
      throw new Error('plugin_runtime_start_cancelled')
    }
    runtimes.set(pluginId, runtime)
    void notePluginSuccess(pluginId)
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'runtime_started',
      status: 'ok',
      protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
      toolCount: tools.length,
    })
    return { runtime, tools }
  } catch (error) {
    runtime.dispose()
    if (!(error instanceof Error && error.message === 'plugin_runtime_start_cancelled')) {
      const message = error instanceof Error ? error.message : 'load_failed'
      await notePluginFailure(pluginId, 'error', message)
      appendPluginAudit({
        at: Date.now(),
        principal: { kind: 'plugin', pluginId },
        event: 'runtime_start_failed',
        status: 'error',
        reason: message.slice(0, 160),
      })
    }
    throw error
  } finally {
    if (startingRuntimes.get(pluginId) === runtime) startingRuntimes.delete(pluginId)
  }
}

export function disposePluginRuntime(pluginId: string): void {
  runtimeGenerations.set(pluginId, (runtimeGenerations.get(pluginId) ?? 0) + 1)
  startingRuntimes.get(pluginId)?.dispose()
  startingRuntimes.delete(pluginId)
  runtimes.get(pluginId)?.dispose()
  runtimes.delete(pluginId)
  runtimeStarts.delete(pluginId)
}

/** Stops active and still-booting isolates when the global plugin feature is switched off. */
export function disposeAllPluginRuntimes(reason = 'plugin_feature_disabled'): void {
  const pluginIds = new Set([
    ...runtimes.keys(),
    ...startingRuntimes.keys(),
    ...runtimeStarts.keys(),
  ])
  for (const pluginId of pluginIds) {
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'runtime_stopped',
      reason,
    })
    disposePluginRuntime(pluginId)
  }
}

export async function invokeLoadedPluginTool(
  pluginId: string,
  runtime: PluginRuntime,
  name: string,
  args: JsonValue,
  timeoutMs?: number,
  context: PluginInvocationContext = {}
): Promise<JsonValue> {
  if (!isPluginFeatureEnabled()) {
    runtime.dispose()
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'invocation_denied',
      toolName: name,
      reason: 'plugin_feature_disabled',
      status: 'denied',
    })
    throw new Error('plugin_feature_disabled')
  }
  try {
    const result = await runtime.invokeTool(name, args, timeoutMs, context)
    await notePluginSuccess(pluginId).catch(() => {})
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'invocation_succeeded',
      status: 'ok',
      toolName: name.slice(0, 160),
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'plugin_invocation_failed'
    if (message === 'cancelled' || message === 'disposed') {
      appendPluginAudit({
        at: Date.now(),
        principal: { kind: 'plugin', pluginId },
        event: 'invocation_cancelled',
        status: 'cancelled',
        toolName: name.slice(0, 160),
      })
      if (runtime.isDisposed() && runtimes.get(pluginId) === runtime) runtimes.delete(pluginId)
      throw error
    }
    await notePluginFailure(pluginId, message === 'timeout' ? 'timeout' : 'error', message).catch(() => {})
    appendPluginAudit({
      at: Date.now(),
      principal: { kind: 'plugin', pluginId },
      event: 'invocation_failed',
      status: message === 'timeout' ? 'timeout' : 'error',
      toolName: name.slice(0, 160),
      reason: message.slice(0, 160),
    })
    if (runtime.isDisposed() && runtimes.get(pluginId) === runtime) runtimes.delete(pluginId)
    throw error
  }
}

const PLUGIN_AUDIT_KEY = 'yachiyo-plugin-audit-v1'
const PLUGIN_AUDIT_MAX = 200

function appendPluginAudit(entry: unknown): void {
  try {
    const list = JSON.parse(localStorage.getItem(PLUGIN_AUDIT_KEY) || '[]') as unknown[]
    list.push(entry)
    localStorage.setItem(PLUGIN_AUDIT_KEY, JSON.stringify(list.slice(-PLUGIN_AUDIT_MAX)))
  } catch {
    // Audit persistence is best-effort; failure must not break the tool call.
  }
}

/** React plugin-view failures stay local and never reach the app's general Sentry boundary. */
export function recordPluginUiFailure(pluginId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'plugin_view_render_failed'
  appendPluginAudit({
    at: Date.now(),
    principal: { kind: 'plugin', pluginId },
    event: 'view_render_failed',
    status: 'error',
    reason: message.slice(0, 160),
  })
  void notePluginFailure(pluginId, 'error', message).catch(() => undefined)
  disposePluginRuntime(pluginId)
}

/** Grant panel API (plat-30): read and flip individual capability grants. Revocation is immediate —
 * the runtime is disposed so the next host call re-evaluates against the new state. */
export async function getPluginGrants(
  record: InstalledPluginRecord
): Promise<Array<{ capability: string; state: 'granted' | 'denied' | 'revoked' | 'none'; domains?: string[] }>> {
  const results: Array<{ capability: string; state: 'granted' | 'denied' | 'revoked' | 'none'; domains?: string[] }> =
    []
  for (const capability of record.manifest.capabilities) {
    const grant = await pluginGrantStore.get(record.manifest.id, capability.name)
    results.push({ capability: capability.name, state: grant?.state ?? 'none', domains: grant?.domains })
  }
  return results
}

export async function setPluginGrant(
  record: InstalledPluginRecord,
  capability: string,
  granted: boolean
): Promise<void> {
  const declared = record.manifest.capabilities.find((entry) => entry.name === capability)
  if (!declared) return
  if (granted && !isPluginCapabilityImplemented(capability)) return
  // Device is additionally signature-gated when the principal/Broker bridge becomes available.
  if (capability === 'device' && granted && !record.deviceGrantAllowed) return
  const grant: PluginGrant = {
    schemaVersion: 1,
    pluginId: record.manifest.id,
    capability: capability as PluginGrant['capability'],
    state: granted ? 'granted' : 'revoked',
    boundEntrySha256: record.manifest.entrySha256 ?? record.packageSha256,
    decidedAt: Date.now(),
    expiresAt: null,
    ...(capability === 'network' && declared.domains ? { domains: declared.domains } : {}),
  }
  await pluginGrantStore.put(grant)
  appendPluginAudit({
    at: Date.now(),
    principal: { kind: 'plugin', pluginId: record.manifest.id },
    event: granted ? 'grant' : 'revoke',
    capability,
  })
  // Immediate effect: kill the live worker so its load-time grant snapshot cannot outlive this change.
  disposePluginRuntime(record.manifest.id)
}

export function readPluginAudit(pluginId?: string, limit = 50): unknown[] {
  try {
    const list = JSON.parse(localStorage.getItem(PLUGIN_AUDIT_KEY) || '[]') as Array<{
      principal?: { pluginId?: string }
    }>
    const filtered = pluginId ? list.filter((entry) => entry.principal?.pluginId === pluginId) : list
    return filtered.slice(-limit).reverse()
  } catch {
    return []
  }
}

export { pluginHealthStore }

let toolsInitialized = false
/** Wires installed plugins' declared tools into the Agent toolset registry (idempotent, at startup). */
export function initPluginTools(): void {
  if (toolsInitialized) return
  toolsInitialized = true
  initPluginToolset({
    listPlugins: async () => {
      if (!isPluginFeatureEnabled()) return []
      const records = await listInstalledPlugins()
      const runnable = await Promise.all(
        records.map(async (record) => {
          try {
            await assertPluginRunnable(record)
            return record
          } catch {
            return null
          }
        })
      )
      return runnable.filter((record): record is InstalledPluginRecord => record !== null)
    },
    grants: {
      async isToolsGranted(record) {
        const grant = await pluginGrantStore.get(record.manifest.id, 'tools')
        const boundSha = record.manifest.entrySha256 ?? record.packageSha256
        return evaluatePluginGrant(grant, {
          pluginId: record.manifest.id,
          capability: 'tools',
          currentEntrySha256: boundSha,
          now: Date.now(),
        }).allowed
      },
    },
    runtime: {
      async invoke(pluginId, toolName, args, timeoutMs, context) {
        const record = await localforagePluginRegistry.get(pluginId)
        if (!record) throw new Error('plugin_not_installed')
        const { runtime } = await ensurePluginRuntime(record)
        return invokeLoadedPluginTool(pluginId, runtime, toolName, args as never, timeoutMs, context)
      },
      terminate: (pluginId) => disposePluginRuntime(pluginId),
    },
    audit: { record: appendPluginAudit },
  })
}
