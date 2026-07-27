import type { ModelInterface } from '@shared/models/types'
import type { KnowledgeBase, Message } from '@shared/types'
import type { ToolSet } from 'ai'
import { registerBuiltinToolsets, toolsetContextFromLegacyOptions } from '@/features/builtin-toolsets'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { buildRegisteredToolsets } from '@/features/toolset-registry'
import platform from '@/platform'

// Re-export for backward compatibility with existing callers.
export { generateSkillsXml } from './skills-xml'

export interface BuildToolsOptions {
  messages: Message[]
  /** Canonical per-feature configuration used by production call sites. */
  featureOptions?: Readonly<Record<string, unknown>>
  /** @deprecated Compatibility fields for older callers. */
  webBrowsing?: boolean
  /** @deprecated Use featureOptions['knowledge-base']. */
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  /** @deprecated Use featureOptions.sandbox. */
  sandboxEnabled?: boolean
  /** @deprecated Use featureOptions.skills. */
  enabledSkillNames?: string[]
  /** Generated run id used by Broker checkpoints and precise cancellation. */
  agentSessionId?: string
  /** Conversation id used for persisted approval policy. */
  agentApprovalSessionId?: string
  /** @deprecated Use featureOptions.camera. */
  cameraSessionId?: string
  /** Adds phone-control tools without removing internal Agent tools. */
  /** @deprecated Use featureOptions['android-device']. */
  deviceControlEnabled?: boolean
}

export interface BuildToolsResult {
  tools: ToolSet
  instructions: string
  /** Initial model-visible Android tool names; later stages are selected by the SDK. */
  activeTools?: string[]
}

function ensureRegistered(): void {
  registerBuiltinFeatures()
  registerBuiltinToolsets()
}

/**
 * Builds the tool set and instructions for a chat session based on model capabilities and session options.
 *
 * Returns tools only for features the model supports.
 * Returns instructions for the system prompt describing available toolsets.
 *
 * This function now delegates to the feature toolset registry (migration-02). The inline logic has been
 * moved to `src/renderer/features/builtin-toolsets.ts`; this thin wrapper remains for API stability.
 */
export async function buildToolsForSession(
  model: ModelInterface,
  options: BuildToolsOptions
): Promise<BuildToolsResult> {
  ensureRegistered()
  const context = toolsetContextFromLegacyOptions(model, options, platform.type, getEnabledFeatureIds())
  return buildRegisteredToolsets(context)
}
