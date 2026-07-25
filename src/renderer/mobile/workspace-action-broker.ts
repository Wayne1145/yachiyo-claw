import { requestAgentApproval, type AgentApprovalRequest } from './agent-approval'

type BrokerRequest = Omit<AgentApprovalRequest, 'id' | 'sessionId'> & {
  sessionId?: string | null
  mutating?: boolean
}

/** Keeps workspace/browser native mutations behind the same policy gate as device tools. */
export async function runWorkspaceBrokeredAction<T>(
  request: BrokerRequest,
  action: () => Promise<T>,
  denied: T,
): Promise<T> {
  if (!(await requestAgentApproval(request))) return denied
  return action()
}
