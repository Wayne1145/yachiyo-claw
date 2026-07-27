import type { ToolsetContext } from './toolset-contract'

export type PromptChannel = 'agent-system' | 'toolset' | 'session-system'

export interface PromptContext extends ToolsetContext {
  /** Toolset factories that returned a contribution for this turn. */
  activeToolsetFeatureIds?: ReadonlySet<string>
}

export interface PromptBlock {
  featureId: string
  channel: PromptChannel
  blockName: string
  order: number
  render: (context: PromptContext) => string | null
  /** Explicit explanation used when this module/session capability is disabled. */
  renderDisabled?: (context: PromptContext) => string | null
  /** Toolset-channel blocks cannot outlive the feature's actual toolset contribution. */
  requiresActiveToolset?: boolean
}
