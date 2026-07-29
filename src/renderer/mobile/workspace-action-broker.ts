import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import { requestAgentApproval, type AgentApprovalRequest } from './agent-approval'

type BrokerRequest = Omit<AgentApprovalRequest, 'id' | 'sessionId' | 'principal'> & {
  sessionId?: string | null
  mutating?: boolean
  alwaysAsk?: boolean
}

/** Keeps workspace/browser native mutations behind the same policy gate as device tools. */
export async function runWorkspaceBrokeredAction<T>(
  request: BrokerRequest,
  action: () => Promise<T>,
  denied: T,
): Promise<T> {
  if (!(await requestAgentApproval({ ...request, principal: CORE_AGENT_PRINCIPAL }))) return denied
  return action()
}
