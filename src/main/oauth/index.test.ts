import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthIpcChannels } from '@shared/oauth'

type IpcHandler = (...args: unknown[]) => Promise<string> | string
type MockProvider = {
  kind: 'callback' | 'code-paste' | 'device-code'
  providerId: string
  name: string
  login?: ReturnType<typeof vi.fn>
  refreshToken: ReturnType<typeof vi.fn>
  startLogin?: ReturnType<typeof vi.fn>
  exchangeCode?: ReturnType<typeof vi.fn>
  codeInputMessage?: string
  startDeviceFlow?: ReturnType<typeof vi.fn>
  waitForToken?: ReturnType<typeof vi.fn>
}

const mockState = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const shellOpenExternal = vi.fn()
  const callbackProvider: MockProvider = {
    kind: 'callback',
    providerId: 'openai',
    name: 'OpenAI',
    login: vi.fn(),
    refreshToken: vi.fn(),
  }
  const codePasteProvider: MockProvider = {
    kind: 'code-paste',
    providerId: 'claude',
    name: 'Claude',
    codeInputMessage: 'Paste code',
    startLogin: vi.fn(),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
  }
  const deviceProvider: MockProvider = {
    kind: 'device-code',
    providerId: 'qwen-portal',
    name: 'Qwen Portal',
    startDeviceFlow: vi.fn(),
    waitForToken: vi.fn(),
    refreshToken: vi.fn(),
  }
  const deviceCnProvider: MockProvider = {
    kind: 'device-code',
    providerId: 'minimax-cn',
    name: 'MiniMax CN',
    startDeviceFlow: vi.fn(),
    waitForToken: vi.fn(),
    refreshToken: vi.fn(),
  }
  const deviceGlobalProvider: MockProvider = {
    kind: 'device-code',
    providerId: 'minimax',
    name: 'MiniMax Global',
    startDeviceFlow: vi.fn(),
    waitForToken: vi.fn(),
    refreshToken: vi.fn(),
  }
  const copilotProvider: MockProvider = {
    kind: 'device-code',
    providerId: 'github-copilot',
    name: 'GitHub Copilot',
    startDeviceFlow: vi.fn(),
    waitForToken: vi.fn(),
    refreshToken: vi.fn(),
  }

  return {
    handlers,
    shellOpenExternal,
    callbackProvider,
    codePasteProvider,
    deviceProvider,
    deviceCnProvider,
    deviceGlobalProvider,
    copilotProvider,
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mockState.handlers.set(channel, handler)
    }),
  },
  shell: {
    openExternal: mockState.shellOpenExternal,
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./providers/openai', () => ({
  openaiOAuthProvider: mockState.callbackProvider,
}))

vi.mock('./providers/anthropic', () => ({
  anthropicOAuthProvider: mockState.codePasteProvider,
}))

vi.mock('./providers/qwen', () => ({
  qwenPortalOAuthProvider: mockState.deviceProvider,
}))

vi.mock('./providers/minimax', () => ({
  minimaxOAuthProvider: mockState.deviceGlobalProvider,
  minimaxCnOAuthProvider: mockState.deviceCnProvider,
}))

vi.mock('./providers/github-copilot', () => ({
  githubCopilotOAuthProvider: mockState.copilotProvider,
}))

vi.mock('./registry', () => {
  const providers = new Map<string, MockProvider>()
  return {
    registerOAuthProvider: vi.fn((provider: MockProvider) => {
      providers.set(provider.providerId, provider)
    }),
    getOAuthProvider: vi.fn((providerId: string) => providers.get(providerId)),
    getRegisteredOAuthProviders: vi.fn(() => Array.from(providers.values())),
  }
})

import { registerOAuthHandlers } from './index'

describe('registerOAuthHandlers', () => {
  beforeEach(() => {
    mockState.handlers.clear()
    mockState.shellOpenExternal.mockReset()
    mockState.callbackProvider.login?.mockReset()
    mockState.callbackProvider.refreshToken.mockReset()
    mockState.deviceProvider.startDeviceFlow?.mockReset()
    mockState.deviceProvider.waitForToken?.mockReset()
    registerOAuthHandlers()
  })

  it('rejects malformed refresh credentials before calling provider.refreshToken', async () => {
    const refreshHandler = mockState.handlers.get(OAuthIpcChannels.REFRESH)
    expect(refreshHandler).toBeDefined()

    const resultJson = await refreshHandler?.(
      undefined,
      'openai',
      JSON.stringify({ accessToken: 'ok', expiresAt: 'bad' })
    )
    const result = JSON.parse(String(resultJson))

    expect(result.success).toBe(false)
    expect(result.error).toContain('expiresAt')
    expect(mockState.callbackProvider.refreshToken).not.toHaveBeenCalled()
  })

  it('returns login cancelled without polling when a device flow was already cancelled', async () => {
    mockState.deviceProvider.startDeviceFlow?.mockResolvedValue({
      userCode: 'code',
      verificationUri: 'https://example.com/device',
    })

    const startHandler = mockState.handlers.get(OAuthIpcChannels.START_DEVICE_FLOW)
    const cancelHandler = mockState.handlers.get(OAuthIpcChannels.CANCEL)
    const waitHandler = mockState.handlers.get(OAuthIpcChannels.WAIT_DEVICE_TOKEN)

    await startHandler?.(undefined, 'qwen-portal')
    await cancelHandler?.(undefined, 'qwen-portal')
    const resultJson = await waitHandler?.(undefined, 'qwen-portal')
    const result = JSON.parse(String(resultJson))

    expect(result).toEqual({
      success: false,
      error: 'Login cancelled',
    })
    expect(mockState.deviceProvider.waitForToken).not.toHaveBeenCalled()
  })
})
