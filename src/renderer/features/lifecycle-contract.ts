export type AgentRunCleanup = () => Promise<void> | void

export interface AgentRunContext {
  agentRunId: string
  taskId: string
  abortSignal: AbortSignal
  requestAbort: () => void
  featureOptions: Readonly<Record<string, unknown>>
  setFeatureState: (featureId: string, value: unknown) => void
  getFeatureState: <T>(featureId: string) => T | undefined
}

export interface FeatureLifecycle {
  featureId: string
  init?: () => Promise<void> | void
  onAgentRunStart?: (context: AgentRunContext) => Promise<AgentRunCleanup | void> | AgentRunCleanup | void
  onAppResume?: () => Promise<void> | void
}
