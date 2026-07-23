import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AgentApprovalRequest,
  assessShellRisk,
  onAgentApprovalRequest,
  requestAgentApproval,
  resolveAgentApproval,
} from './agent-approval'
import { copyAgentSessionConfig, getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'

describe('Agent session configuration', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  it('persists per-conversation backend and approval policy', () => {
    saveAgentSessionConfig('chat-1', {
      configured: true,
      enabled: true,
      deviceControlEnabled: true,
      backend: 'shizuku',
      approvalMode: 'smart',
    })
    expect(getAgentSessionConfig('chat-1')).toMatchObject({
      configured: true,
      enabled: true,
      deviceControlEnabled: true,
      backend: 'shizuku',
      approvalMode: 'smart',
    })
  })

  it('copies conversation settings without copying an approval bypass', () => {
    saveAgentSessionConfig('source', { allowDangerousForConversation: true, configured: true })
    expect(copyAgentSessionConfig('source', 'fork').allowDangerousForConversation).toBe(false)
  })

  it('keeps phone control off by default for a new internal Agent', () => {
    const config = saveAgentSessionConfig('internal-only', { enabled: true, configured: true })

    expect(config.enabled).toBe(true)
    expect(config.deviceControlEnabled).toBe(false)
  })

  it('migrates legacy enabled conversations with their previous phone-control behavior', () => {
    localStorage.setItem(
      'yachiyo-agent-session-config-v1',
      JSON.stringify({ legacy: { enabled: true, configured: true, backend: 'root' } }),
    )

    expect(getAgentSessionConfig('legacy').deviceControlEnabled).toBe(true)
  })

  it('marks destructive shell commands as dangerous', () => {
    expect(assessShellRisk('ls -la')).toBe('safe')
    expect(assessShellRisk('pm clear com.example.app')).toBe('dangerous')
    expect(assessShellRisk('rm -rf /data/local/tmp/work')).toBe('dangerous')
  })

  it('pauses manual device operations until the user allows them once', async () => {
    saveAgentSessionConfig('manual-chat', { configured: true, approvalMode: 'manual' })
    let request: AgentApprovalRequest | undefined
    const unsubscribe = onAgentApprovalRequest((next) => {
      request = next
    })
    const result = requestAgentApproval({
      sessionId: 'manual-chat',
      title: '点击屏幕',
      detail: '(540, 960)',
      risk: 'safe',
    })
    expect(request?.title).toBe('点击屏幕')
    resolveAgentApproval(request!.id, 'once')
    await expect(result).resolves.toBe(true)
    unsubscribe()
  })

  it('lets smart review pass safe operations without prompting', async () => {
    saveAgentSessionConfig('smart-chat', { configured: true, approvalMode: 'smart' })
    await expect(
      requestAgentApproval({
        sessionId: 'smart-chat',
        title: '滑动屏幕',
        detail: 'scroll',
        risk: 'safe',
      }),
    ).resolves.toBe(true)
  })
})
