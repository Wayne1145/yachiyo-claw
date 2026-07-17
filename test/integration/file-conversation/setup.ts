/**
 * 文件对话集成测试的 setup 文件
 *
 * platform/index.ts 会根据 NODE_ENV=test 自动返回 TestPlatform
 * 这里只需要 mock 一些会导致初始化问题的模块
 */

import { vi } from 'vitest'
import platform from '../../../src/renderer/platform'
import type TestPlatform from '../../../src/renderer/platform/test_platform'

// Mock localStorage（Node.js 环境没有 localStorage）
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}
;(globalThis as any).localStorage = localStorageMock

// Mock window（某些模块可能依赖 window）
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = {
    localStorage: localStorageMock,
  }
}

// Mock settingActions（避免依赖真实的 store）
vi.mock('@/stores/settingActions', () => ({
  getLicenseKey: () => process.env.CHATBOX_LICENSE_KEY || '',
  isPro: () => !!process.env.CHATBOX_LICENSE_KEY,
  getRemoteConfig: () => ({}),
}))

// Mock settingsStore
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        licenseKey: process.env.CHATBOX_LICENSE_KEY || '',
        language: 'en',
      }),
    }),
  },
}))

// Mock uiStore（避免 localStorage 访问）
vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      inputBoxWebBrowsingMode: false,
      sessionKnowledgeBaseMap: {},
    }),
  },
}))

// Mock mcp controller（避免 MCP 服务器初始化）
vi.mock('@/packages/mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({}),
  },
}))

// Mock router
vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
  },
}))

// Mock tracking
vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

// 导出 TestPlatform 实例（由 platform/index.ts 自动创建）
export function getTestPlatform(): TestPlatform {
  return platform as TestPlatform
}

export function resetTestPlatform(): void {
  ;(platform as TestPlatform).clear()
}
