import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPrincipal } from '@shared/agent'
import {
  cancelPendingAgentApprovals,
  onAgentApprovalRequest,
  requestAgentAuthorization,
  resolveAgentApproval,
} from '@/mobile/agent-approval'
import { digestAgentJson, executeAgentAction, readAgentAudit } from '@/mobile/agent-broker'
import { type AgentCheckpointStorage, AgentCheckpointStore } from '@/mobile/agent-checkpoints'
import { saveAgentSessionConfig } from '@/mobile/agent-session-config'

const principal: AgentPrincipal = {
  kind: 'plugin',
  pluginId: 'demo',
  entrySha256: 'a'.repeat(64),
}

class MemoryCheckpointStorage implements AgentCheckpointStorage {
  private readonly values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

describe('plugin approval and Broker audit boundaries', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  afterEach(() => {
    cancelPendingAgentApprovals()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not let a core conversation-wide approval bypass a plugin approval', async () => {
    saveAgentSessionConfig('chat', {
      approvalMode: 'manual',
      allowDangerousForConversation: true,
    })
    const requests: Array<{ id: string; principal: AgentPrincipal }> = []
    const unsubscribe = onAgentApprovalRequest((request) => requests.push(request))

    const authorization = requestAgentAuthorization({
      principal,
      sessionId: 'chat',
      runId: 'run-plugin',
      title: 'Plugin device action',
      detail: 'Click a semantic target',
      risk: 'dangerous',
      rememberConversationApproval: false,
    })

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].principal).toEqual(principal)
    resolveAgentApproval(requests[0].id, 'once')
    await expect(authorization).resolves.toEqual({ decision: 'once' })
    unsubscribe()
  })

  it('records the exact plugin principal, backend, parameter digest, and decision', async () => {
    const parameters = { command: 'printf ok', workspace: 'plugin/demo' }
    const checkpointStore = new AgentCheckpointStore({ storage: new MemoryCheckpointStorage() })

    await executeAgentAction({
      featureId: 'plugins',
      principal,
      toolId: 'plugin.sandbox.exec',
      backend: 'sandbox',
      parameters,
      taskId: 'plugin-task',
      stepId: 'plugin-step',
      callId: 'plugin-call',
      sideEffect: true,
      approvalDecision: 'once',
      checkpointStore,
      isSuccess: (result: { success: boolean }) => result.success,
      execute: async () => ({ success: true }),
    })

    expect(readAgentAudit({ pluginId: 'demo', limit: 1 })).toEqual([
      expect.objectContaining({
        callId: 'plugin-call',
        toolId: 'plugin.sandbox.exec',
        principal,
        backend: 'sandbox',
        parameterDigest: await digestAgentJson(parameters),
        approvalDecision: 'once',
        status: 'success',
      }),
    ])
  })
})
