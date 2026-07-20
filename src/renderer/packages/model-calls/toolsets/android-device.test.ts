import { beforeEach, describe, expect, it, vi } from 'vitest'

const getInfoMock = vi.hoisted(() => vi.fn())
const requestAgentApprovalMock = vi.hoisted(() => vi.fn())
const accessibilityActionMock = vi.hoisted(() => vi.fn())
const executeAccessibilityActionMock = vi.hoisted(() => vi.fn())
const executeAppLaunchMock = vi.hoisted(() => vi.fn())
const executeCompanionActionMock = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: getInfoMock,
  },
}))

vi.mock('@/mobile/agent-broker', () => ({
  executeRootShell: vi.fn(),
  executeAccessibilityAction: executeAccessibilityActionMock,
  executeAppLaunch: executeAppLaunchMock,
  executeCompanionAction: executeCompanionActionMock,
  getAgentBackend: () => 'accessibility',
}))

vi.mock('@/mobile/agent-approval', () => ({
  requestAgentApproval: requestAgentApprovalMock,
}))

vi.mock('@/platform/native/yachiyo_device_access', () => ({
  compactSemanticObservation: (output: string) => output,
  yachiyoDeviceAccessNative: {
    accessibilityAction: accessibilityActionMock,
    listLaunchableApps: vi.fn(),
  },
}))

import { createAndroidDeviceToolSet, onAndroidDeviceOperation } from './android-device'

type DeviceInfoTool = {
  execute: (input: Record<string, never>, context: Record<string, never>) => Promise<Record<string, unknown>>
}

describe('Android device tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestAgentApprovalMock.mockResolvedValue(true)
    accessibilityActionMock.mockResolvedValue({ success: true, output: '{"version":1,"nodes":[]}' })
    executeAccessibilityActionMock.mockImplementation((options: Record<string, unknown>) =>
      accessibilityActionMock(options),
    )
    executeAppLaunchMock.mockResolvedValue({ success: true })
    executeCompanionActionMock.mockResolvedValue({
      success: true,
      data: { ok: true },
      fallbackToNative: false,
      responseBytes: 10,
    })
    getInfoMock.mockResolvedValue({
      platform: 'android',
      manufacturer: 'Google',
      model: 'Pixel 8 Pro',
      name: 'sdk_gphone64_x86_64',
      operatingSystem: 'android',
      osVersion: '15',
      androidSDKVersion: 35,
      isVirtual: true,
      webViewVersion: '131.0.6778.81',
    })
  })

  it('exposes read-only device information without approval or operation overlay', async () => {
    const operationListener = vi.fn()
    const removeListener = onAndroidDeviceOperation(operationListener)

    try {
      const toolSet = createAndroidDeviceToolSet('session-1')
      const result = await (toolSet.tools.android_device_info as unknown as DeviceInfoTool).execute({}, {})

      expect(result).toEqual({
        platform: 'android',
        manufacturer: 'Google',
        model: 'Pixel 8 Pro',
        name: 'sdk_gphone64_x86_64',
        operatingSystem: 'android',
        osVersion: '15',
        androidSdkVersion: 35,
        isVirtual: true,
        webViewVersion: '131.0.6778.81',
      })
      expect(requestAgentApprovalMock).not.toHaveBeenCalled()
      expect(operationListener).not.toHaveBeenCalled()
    } finally {
      removeListener()
    }
  })

  it('uses the bounded semantic observation in accessibility mode', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const observe = toolSet.tools.android_observe as unknown as {
      execute: (input: Record<string, never>, context: Record<string, never>) => Promise<unknown>
    }

    await observe.execute({}, {})
    expect(accessibilityActionMock).toHaveBeenCalledWith({ action: 'observeSemantic' })
  })

  it('supports selector-based accessibility actions', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const click = toolSet.tools.android_click_node as unknown as {
      execute: (input: Record<string, string>, context: Record<string, never>) => Promise<unknown>
    }

    await click.execute({ resource_id: 'com.example:id/follow' }, {})
    expect(accessibilityActionMock).toHaveBeenCalledWith({
      action: 'clickNode',
      packageName: undefined,
      resourceId: 'com.example:id/follow',
      text: undefined,
      contentDescription: undefined,
      role: undefined,
      ancestorSignature: undefined,
    })
  })

  it('keeps selector text separate from replacement text', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const setText = toolSet.tools.android_set_node_text as unknown as {
      execute: (input: Record<string, string>, context: Record<string, never>) => Promise<unknown>
    }

    await setText.execute({ resource_id: 'com.example:id/name', text: 'old value', text_value: 'new value' }, {})
    expect(accessibilityActionMock).toHaveBeenCalledWith({
      action: 'setNodeText',
      packageName: undefined,
      resourceId: 'com.example:id/name',
      text: 'new value',
      selectorText: 'old value',
      contentDescription: undefined,
      role: undefined,
      ancestorSignature: undefined,
    })
  })

  it('approves semantic scroll parameters before executing them', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const scroll = toolSet.tools.android_scroll_node as unknown as {
      execute: (input: Record<string, string>, context: Record<string, never>) => Promise<unknown>
    }

    await scroll.execute({ resource_id: 'com.example:id/list', direction: 'down' }, {})

    expect(requestAgentApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        risk: 'dangerous',
        detail: expect.stringContaining('com.example:id/list'),
      }),
    )
    expect(accessibilityActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scrollNode', resourceId: 'com.example:id/list', direction: 'down' }),
    )
  })

  it('does not execute semantic scroll when approval is denied', async () => {
    requestAgentApprovalMock.mockResolvedValueOnce(false)
    const toolSet = createAndroidDeviceToolSet('session-1')
    const scroll = toolSet.tools.android_scroll_node as unknown as {
      execute: (input: Record<string, string>, context: Record<string, never>) => Promise<Record<string, unknown>>
    }

    await expect(scroll.execute({ text: 'Feed', direction: 'forward' }, {})).resolves.toMatchObject({ exitCode: 126 })
    expect(accessibilityActionMock).not.toHaveBeenCalled()
  })

  it('normalizes companion parameters and approves the parameters sent to the Broker', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const companion = toolSet.tools.android_companion_action as unknown as {
      execute: (input: unknown, context: { toolCallId: string }) => Promise<unknown>
    }

    await companion.execute(
      {
        capability: 'setText',
        parameters: { selector: { resourceId: '  com.example:id/name  ' }, text: 'private value' },
      },
      { toolCallId: 'companion-1' },
    )

    const approvedDetail = requestAgentApprovalMock.mock.calls[0][0].detail as string
    expect(approvedDetail).toContain('com.example:id/name')
    expect(approvedDetail).toContain('[redacted 13 chars]')
    expect(approvedDetail).not.toContain('private value')
    expect(executeCompanionActionMock).toHaveBeenCalledWith(
      'setText',
      { selector: { resourceId: 'com.example:id/name' }, text: 'private value' },
      expect.objectContaining({ taskId: 'session-1', toolCallId: 'companion-1' }),
    )
  })

  it('rejects companion parameters outside the canonical capability schema', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const companion = toolSet.tools.android_companion_action as unknown as {
      execute: (input: unknown, context: Record<string, never>) => Promise<unknown>
    }

    await expect(
      companion.execute({ capability: 'click', parameters: { selector: { text: 'OK' }, command: 'rm -rf /' } }, {}),
    ).rejects.toThrow()
    expect(requestAgentApprovalMock).not.toHaveBeenCalled()
    expect(executeCompanionActionMock).not.toHaveBeenCalled()
  })

  it('does not call a companion when approval is denied', async () => {
    requestAgentApprovalMock.mockResolvedValueOnce(false)
    const toolSet = createAndroidDeviceToolSet('session-1')
    const companion = toolSet.tools.android_companion_action as unknown as {
      execute: (input: unknown, context: Record<string, never>) => Promise<Record<string, unknown>>
    }

    await expect(
      companion.execute({ capability: 'launch', parameters: { packageName: 'com.example.app' } }, {}),
    ).resolves.toMatchObject({ exitCode: 126 })
    expect(executeCompanionActionMock).not.toHaveBeenCalled()
  })

  it('launches a package through the unified Broker path', async () => {
    const toolSet = createAndroidDeviceToolSet('session-1')
    const launch = toolSet.tools.android_launch_app as unknown as {
      execute: (input: { package_name: string }, context: { toolCallId: string }) => Promise<unknown>
    }

    await expect(launch.execute({ package_name: 'com.example.app' }, { toolCallId: 'tool-1' })).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })
    expect(executeAppLaunchMock).toHaveBeenCalledWith(
      'com.example.app',
      undefined,
      expect.objectContaining({ taskId: 'session-1', callId: expect.stringContaining('tool-1-intent') }),
    )
  })
})
