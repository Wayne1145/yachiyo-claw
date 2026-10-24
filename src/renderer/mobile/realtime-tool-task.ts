import { copyAgentSessionConfig, getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'
import { ensureAgentTaskForChat } from './conversation-bridge'

/** Realtime owns an internal-tool task regardless of the previously selected chat/Agent tab. */
export async function ensureRealtimeToolTask(sessionId: string): Promise<string> {
  const task = await ensureAgentTaskForChat(sessionId)
  if (!getAgentSessionConfig(task.id).configured) copyAgentSessionConfig(sessionId, task.id)
  // Preserve explicit phone-control and approval choices; enabling internal tools is not a permission grant.
  saveAgentSessionConfig(task.id, { enabled: true, configured: true })
  return task.id
}
