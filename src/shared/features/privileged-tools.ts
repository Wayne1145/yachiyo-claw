import { TOOL_IDS } from '../agent/tool-ids'

/**
 * Tool ids that only a `privileged` feature module may declare.
 *
 * Every id in the current `TOOL_IDS` registry reaches a privileged device backend — the accessibility
 * service, Shizuku, root, or adb (see `agent-broker.ts` `toolIdForAccessibilityAction` /
 * `isAccessibilitySideEffect`) — or gates background execution via a scheduled grant
 * (`agent.schedule.*`, which mint `BackgroundGrant`s in `contracts.ts`). So the whole registry is
 * privileged. Erring toward privileged is the safe default for this gate: a benign id wrongly marked
 * privileged only stops an inert built-in from declaring it, whereas a dangerous id wrongly marked
 * non-privileged would leak to a third-party module. Non-privileged tools (web search, sandbox files,
 * RAG) are exported by toolsets, not `tool-ids.ts`, and are intentionally absent here.
 */
export const PRIVILEGED_TOOL_IDS: ReadonlySet<string> = new Set<string>(Object.values(TOOL_IDS))

export function isPrivilegedToolId(id: string): boolean {
  return PRIVILEGED_TOOL_IDS.has(id)
}
