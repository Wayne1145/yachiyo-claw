import { getAgentSessionConfig } from './agent-session-config'

const DISABLED_AGENT_PROMPT = `
<agent_status enabled="false">
Internal Agent tools are currently disabled for this conversation. If the user asks for work that
requires Skills, MCP, the local Linux sandbox, project files, or phone control, do not only say that
you cannot do it. Briefly tell the user to enable "Agent 能力" in the conversation header. If the
request also requires inspecting or operating Android itself, tell them to additionally enable
"手机控制" in Agent settings. Never claim that a tool action ran while Agent is disabled.
</agent_status>
`.trim()

export function getDisabledAgentCapabilityPrompt(sessionId: string): string {
  return getAgentSessionConfig(sessionId).enabled ? '' : DISABLED_AGENT_PROMPT
}
