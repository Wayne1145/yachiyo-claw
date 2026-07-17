import { beforeEach, describe, expect, it, vi } from 'vitest'

const getInfoMock = vi.hoisted(() => vi.fn())
const requestAgentApprovalMock = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: getInfoMock,
  },
}))

vi.mock('@/mobile/agent-broker', () => ({
  executeRootShell: vi.fn(),
  getAgentBackend: () => 'accessibility',
}))

vi.mock('@/mobile/agent-approval', () => ({
  requestAgentApproval: requestAgentApprovalMock,
}))

vi.mock('@/platform/native/yachiyo_device_access', () => ({
  yachiyoDeviceAccessNative: {
    accessibilityAction: vi.fn(),
  },
}))

import { createAndroidDeviceToolSet, onAndroidDeviceOperation } from './android-device'

type DeviceInfoTool = {
  execute: (input: Record<string, never>, context: Record<string, never>) => Promise<Record<string, unknown>>
}

describe('Android device tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
