import { jsonSchema, tool, type ToolSet } from 'ai'
import { evaluatePluginGrant } from '@shared/plugins/grants'
import { validatePluginToolInputSchema } from '@shared/plugins/tool-schema'
import { projectAgentResult } from '@/mobile/agent-result-policy'
import { requestAgentApproval } from '@/mobile/agent-approval'
import type { FeatureToolsetFactory } from '@/features/toolset-contract'
import { registerFeatureToolset } from '@/features/toolset-registry'
import type { InstalledPluginRecord } from './installer'
import type { PluginInvocationContext } from './plugin-runtime'

/**
 * Plugin tool contributions → Agent ToolSet (platform-25, non-privileged only).
 *
 * Mirrors the MCP bridge but with plugin-specific policy:
 * - Registration gate: plugin enabled, `tools` capability granted (digest-bound), name prefixed with
 *   `<pluginId>_`, restricted JSON Schema subset, per-plugin (8) and global (32) tool caps. A tool
 *   failing any gate is skipped with a visible reason; other tools are unaffected.
 * - Name collisions reject the LATER plugin's tool (never silent override) with a visible reason.
 * - Approval: unlike MCP's blanket 'dangerous', risk maps from the declared level — read → 'safe'
 *   (auto-passes unless the user chose manual-approve-everything), act → 'dangerous' (always
 *   prompted). Plugin tools cannot declare higher levels at all (manifest enum).
 * - Execution: grant re-checked AT CALL TIME (mid-session revocation → error result, session keeps
 *   its tool list), forwarded to the isolate with a timeout (the runtime rejects and the manager
 *   disposes the worker), result clamped by projectAgentResult (8KB), audited with a plugin principal.
 */

export const PLUGIN_TOOL_LIMITS = { maxToolsPerPlugin: 8, maxToolsTotal: 32, timeoutMs: 20_000 } as const

export interface PluginToolRuntimePort {
  /** Invoke a named tool inside the plugin's isolate. Must reject on timeout. */
  invoke(
    pluginId: string,
    toolName: string,
    args: unknown,
    timeoutMs: number,
    context: PluginInvocationContext,
  ): Promise<unknown>
  /** Kill the plugin's isolate (called after a timeout so a runaway handler cannot keep running). */
  terminate(pluginId: string): void
}

export interface PluginToolGrantPort {
  /** Current grant decision for the plugin's `tools` capability, digest-bound. */
  isToolsGranted(record: InstalledPluginRecord): Promise<boolean>
}

export interface PluginToolAuditPort {
  record(entry: {
    at: number
    principal: { kind: 'plugin'; pluginId: string; entrySha256: string }
    toolName: string
    status: 'ok' | 'denied' | 'error' | 'timeout'
  }): void
}

export interface PluginToolsetSources {
  listPlugins(): Promise<InstalledPluginRecord[]>
  grants: PluginToolGrantPort
  runtime: PluginToolRuntimePort
  audit: PluginToolAuditPort
}

export interface RejectedPluginTool {
  pluginId: string
  toolName: string
  reason: string
}

/** Rejections surfaced to the management UI (why a declared tool is not available). */
export const pluginToolRejections: RejectedPluginTool[] = []

export function buildPluginToolset(sources: PluginToolsetSources): FeatureToolsetFactory {
  return async (context) => {
    const records = await sources.listPlugins()
    if (records.length === 0) return null

    pluginToolRejections.length = 0
    const tools: ToolSet = {}
    const toolDisplay: Record<string, { label: string }> = {}
    const claimed = new Set<string>()
    let total = 0

    for (const record of records) {
      const declared = record.manifest.contributions.tools ?? []
      if (declared.length === 0) continue
      if (!(await sources.grants.isToolsGranted(record))) {
        for (const declaration of declared) {
          pluginToolRejections.push({
            pluginId: record.manifest.id,
            toolName: declaration.name,
            reason: 'tools_capability_not_granted',
          })
        }
        continue
      }
      let pluginCount = 0
      for (const declaration of declared) {
        const reject = (reason: string) =>
          pluginToolRejections.push({ pluginId: record.manifest.id, toolName: declaration.name, reason })
        if (!declaration.name.startsWith(`${record.manifest.id}_`)) {
          reject('name_not_prefixed')
          continue
        }
        if (pluginCount >= PLUGIN_TOOL_LIMITS.maxToolsPerPlugin) {
          reject('per_plugin_tool_limit')
          continue
        }
        if (total >= PLUGIN_TOOL_LIMITS.maxToolsTotal) {
          reject('total_tool_limit')
          continue
        }
        if (claimed.has(declaration.name)) {
          // A later plugin declaring an already-claimed name is rejected, never silently overridden.
          reject('name_collision')
          continue
        }
        const schemaCheck = validatePluginToolInputSchema(declaration.parameters ?? undefined)
        if (!schemaCheck.ok) {
          reject(`unsupported_schema: ${schemaCheck.reason}`)
          continue
        }

        const pluginId = record.manifest.id
        const entrySha256 = record.manifest.entrySha256 ?? record.packageSha256
        const riskLevel = declaration.riskLevel ?? 'read'
        claimed.add(declaration.name)
        pluginCount += 1
        total += 1

        tools[declaration.name] = tool({
          description: declaration.description,
          inputSchema: jsonSchema<Record<string, unknown>>(
            (declaration.parameters as never) ?? { type: 'object', properties: {}, additionalProperties: false },
          ),
          execute: async (args, toolContext) => {
            const now = Date.now()
            // Revocation mid-session: the tool stays listed for this session but every call
            // re-checks the grant and fails closed.
            if (!(await sources.grants.isToolsGranted(record))) {
              sources.audit.record({
                at: now,
                principal: { kind: 'plugin', pluginId, entrySha256 },
                toolName: declaration.name,
                status: 'denied',
              })
              return { error: 'plugin_tools_capability_revoked' }
            }
            try {
              const approved = await requestAgentApproval({
                principal: { kind: 'plugin', pluginId, entrySha256 },
                sessionId: context.approvalSessionId || context.agentRunId || '',
                title: `插件: ${record.manifest.displayName}/${declaration.name}`,
                detail: JSON.stringify(args, null, 2).slice(0, 4_000),
                risk: riskLevel === 'act' ? 'dangerous' : 'safe',
                rememberConversationApproval: false,
              })
              if (!approved) {
                sources.audit.record({
                  at: now,
                  principal: { kind: 'plugin', pluginId, entrySha256 },
                  toolName: declaration.name,
                  status: 'denied',
                })
                return { error: 'user_denied_plugin_tool' }
              }
              const result = await sources.runtime.invoke(
                pluginId,
                declaration.name,
                args,
                PLUGIN_TOOL_LIMITS.timeoutMs,
                {
                  principal: { kind: 'plugin', pluginId, entrySha256 },
                  sessionId: context.approvalSessionId || context.agentRunId,
                  runId: context.agentRunId,
                  toolCallId: toolContext?.toolCallId,
                  abortSignal: toolContext?.abortSignal,
                },
              )
              sources.audit.record({
                at: now,
                principal: { kind: 'plugin', pluginId, entrySha256 },
                toolName: declaration.name,
                status: 'ok',
              })
              return projectAgentResult(result)
            } catch (error) {
              const timedOut = error instanceof Error && error.message === 'timeout'
              if (timedOut) {
                // A runaway isolate must not keep executing after its result is abandoned.
                sources.runtime.terminate(pluginId)
              }
              sources.audit.record({
                at: now,
                principal: { kind: 'plugin', pluginId, entrySha256 },
                toolName: declaration.name,
                status: timedOut ? 'timeout' : 'error',
              })
              // Return, don't throw: a plugin failure must not break the model call flow (MCP pattern).
              return { error: timedOut ? 'plugin_tool_timeout' : 'plugin_tool_failed' }
            }
          },
        })
        const shortName = declaration.name.slice(`${record.manifest.id}_`.length).replaceAll('_', ' ')
        toolDisplay[declaration.name] = { label: `${record.manifest.displayName} · ${shortName}` }
      }
    }

    if (Object.keys(tools).length === 0) return null
    return { instructions: '', tools, toolDisplay }
  }
}

let registered = false
/** Wires installed plugins' tools into the Tier A toolset registry (idempotent). */
export function initPluginToolset(sources: PluginToolsetSources): void {
  if (registered) return
  registered = true
  registerFeatureToolset('plugins', buildPluginToolset(sources))
}
