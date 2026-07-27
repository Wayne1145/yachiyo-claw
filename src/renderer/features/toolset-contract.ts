import type { ToolSet } from 'ai'
import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import type { TablerIcon } from '@tabler/icons-react'

/**
 * Unified Agent toolset contribution contract (migration-02).
 *
 * Today `tools-builder.ts` hard-codes every feature's enablement, toolset shape, instruction text, and
 * Android active-tool staging inline. This contract lets each feature contribute those four things
 * uniformly. `featureOptions` is keyed by featureId with `unknown` values so the central
 * `BuildToolsOptions` type stops growing — each feature parses its own slice with zod.
 *
 * This is the parallel contract; `buildToolsForSession` is NOT switched over in this step.
 */

/** Shared context passed to every feature toolset factory for one session build. */
export interface ToolsetContext {
  model: ModelInterface
  messages: readonly Message[]
  platformType: string
  /** Run id used by Broker checkpoints and precise cancellation. */
  agentRunId?: string
  /** Conversation id used for persisted approval policy. */
  approvalSessionId?: string
  /** Per-feature session config, keyed by featureId. Replaces the bespoke BuildToolsOptions fields. */
  featureOptions: Readonly<Record<string, unknown>>
  /** Resolved module set for this platform/user. Omitted in isolated tests to keep every factory visible. */
  enabledFeatureIds?: ReadonlySet<string>
}

export interface ToolsetContribution {
  /** Text injected into the system prompt. Empty string means no injection. */
  instructions: string
  tools: ToolSet
  /**
   * Tool names visible to the model on the first turn. Omit to make all of this contribution's tools
   * initially visible. A feature that stages its tools (e.g. Android device control) lists only the
   * initial subset here.
   */
  initialActiveTools?: readonly string[]
  /** Optional conversation UI metadata. Unknown/upstream tools still use the existing static fallback. */
  toolDisplay?: Readonly<Record<string, { label: string; icon?: TablerIcon }>>
}

/** Returns null when the feature is not enabled for this session (and contributes no prompt text). */
export type FeatureToolsetFactory = (context: ToolsetContext) => Promise<ToolsetContribution | null>
