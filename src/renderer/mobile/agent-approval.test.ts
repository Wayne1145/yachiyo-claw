import { Capacitor } from '@capacitor/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import {
  type AgentApprovalRequest,
  cancelPendingAgentApprovals,
  onAgentApprovalRequest,
  requestAgentApproval,
  requestAgentDecision,
  resolveAgentApproval,
} from './agent-approval'
import { getAgentSessionConfig, saveAgentSessionConfig } from './agent-session-config'

describe('Agent approval queue', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  afterEach(() => {
    cancelPendingAgentApprovals()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows one approval at a time', async () => {
    saveAgentSessionConfig('chat', { approvalMode: 'manual' })
    const requests: AgentApprovalRequest[] = []
    const unsubscribe = onAgentApprovalRequest((request) => requests.push(request))

    const first = requestAgentApproval({ sessionId: 'chat', runId: 'run-1', title: 'first', detail: '', risk: 'safe' })
    const second = requestAgentApproval({ sessionId: 'chat', runId: 'run-2', title: 'second', detail: '', risk: 'safe' })

    expect(requests.map((request) => request.title)).toEqual(['first'])
    resolveAgentApproval(requests[0].id, 'once')
    await expect(first).resolves.toBe(true)
    await vi.waitFor(() => expect(requests.map((request) => request.title)).toEqual(['first', 'second']))
    resolveAgentApproval(requests[1].id, 'deny')
    await expect(second).resolves.toBe(false)
    unsubscribe()
  })

  it('denies an active approval when its run is cancelled', async () => {
    saveAgentSessionConfig('chat', { approvalMode: 'manual' })
    const unsubscribe = onAgentApprovalRequest(() => undefined)
    const approval = requestAgentApproval({
      sessionId: 'chat',
      runId: 'chat:assistant-message',
      title: 'tap',
      detail: '',
      risk: 'dangerous',
    })

    cancelPendingAgentApprovals('chat:assistant-message')
    await expect(approval).resolves.toBe(false)
    unsubscribe()
  })

  it('defaults to deny when the tool AbortSignal is cancelled', async () => {
    saveAgentSessionConfig('chat', { approvalMode: 'manual' })
    const controller = new AbortController()
    const unsubscribe = onAgentApprovalRequest(() => undefined)
    const approval = requestAgentApproval({
      sessionId: 'chat',
      runId: 'run-abort',
      title: 'type',
      detail: '',
      risk: 'dangerous',
      signal: controller.signal,
    })

    controller.abort()
    await expect(approval).resolves.toBe(false)
    unsubscribe()
  })

  it('returns loop decisions without granting dangerous actions for the conversation', async () => {
    saveAgentSessionConfig('chat', { approvalMode: 'full', allowDangerousForConversation: false })
    const requests: AgentApprovalRequest[] = []
    const unsubscribe = onAgentApprovalRequest((request) => requests.push(request))
    const decision = requestAgentDecision({
      sessionId: 'chat',
      runId: 'run-loop',
      title: 'loop',
      detail: 'same action repeated',
      risk: 'safe',
      kind: 'loop',
      alwaysAsk: true,
      rememberConversationApproval: false,
    })

    expect(requests[0]?.kind).toBe('loop')
    resolveAgentApproval(requests[0].id, 'conversation')
    await expect(decision).resolves.toBe('conversation')
    expect(getAgentSessionConfig('chat').allowDangerousForConversation).toBe(false)
    unsubscribe()
  })

  it('clears and retries one stale native approval without using the in-app fallback', async () => {
    saveAgentSessionConfig('chat', { approvalMode: 'manual' })
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    vi.spyOn(yachiyoDeviceAccessNative, 'getPermissionStatus').mockResolvedValue({
      overlay: true,
      batteryOptimizationIgnored: true,
      notificationsGranted: true,
      autoStartSettingsAvailable: false,
      deviceManufacturer: 'generic',
      allFiles: false,
      accessibility: true,
      shizukuInstalled: true,
      shizukuRunning: true,
      shizukuGranted: true,
    })
    const nativeRequest = vi
      .spyOn(yachiyoDeviceAccessNative, 'requestOperationApproval')
      .mockRejectedValueOnce(new Error('approval_already_pending'))
      .mockResolvedValueOnce({ decision: 'once' })
    const cancelNative = vi.spyOn(yachiyoDeviceAccessNative, 'cancelOperationApproval').mockResolvedValue()
    const inAppListener = vi.fn()
    const unsubscribe = onAgentApprovalRequest(inAppListener)

    await expect(
      requestAgentApproval({ sessionId: 'chat', runId: 'run-native', title: 'tap', detail: '', risk: 'dangerous' }),
    ).resolves.toBe(true)
    expect(cancelNative).toHaveBeenCalledOnce()
    expect(nativeRequest).toHaveBeenCalledTimes(2)
    expect(inAppListener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
