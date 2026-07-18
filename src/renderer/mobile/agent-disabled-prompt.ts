import { getAgentSessionConfig } from './agent-session-config'

const DISABLED_AGENT_PROMPT = `
<device_agent_status enabled="false">
Device-control tools are currently disabled for this conversation. If the user asks you to inspect,
change, click, launch, type on, or otherwise operate this Android device, do not only say that you
cannot do it. Briefly tell the user to enable "Agent 能力" in the conversation header, then offer to
continue after it is enabled. Never claim that a device action has run while this status is disabled.
</device_agent_status>
`.trim()

export function getDisabledAgentCapabilityPrompt(sessionId: string): string {
  return getAgentSessionConfig(sessionId).enabled ? '' : DISABLED_AGENT_PROMPT
}
