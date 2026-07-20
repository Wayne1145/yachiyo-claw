import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeAccessibilityActionMock = vi.hoisted(() => vi.fn())
const executeAppLaunchMock = vi.hoisted(() => vi.fn())
const launcherContextMock = vi.hoisted(() => vi.fn())

vi.mock('./agent-broker', () => ({
  executeAccessibilityAction: executeAccessibilityActionMock,
  executeAppLaunch: executeAppLaunchMock,
}))

vi.mock('@/platform/native/yachiyo_device_access', () => ({
  yachiyoDeviceAccessNative: {
    getLauncherContext: launcherContextMock,
  },
  parseSemanticSnapshot: (output: string | undefined) => {
    if (!output) return null
    try {
      return JSON.parse(output)
    } catch {
      return null
    }
  },
}))

import type { AgentCheckpointStorage } from './agent-checkpoints'
import { LocalAppLauncher } from './local-app-launcher'

class MemoryStorage implements AgentCheckpointStorage {
  private values = new Map<string, unknown>()

  getStoreValue(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  setStoreValue(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

const app = {
  packageName: 'com.tencent.mm',
  activityName: 'com.tencent.mm.ui.LauncherUI',
  label: '微信',
  aliases: ['WeChat'],
}

const launcherContext = {
  launcherPackage: 'com.android.launcher3',
  launcherVersionCode: 42,
  displayId: 0,
  orientation: 'portrait' as const,
  density: 2.75,
}

function snapshot() {
  return JSON.stringify({
    version: 1,
    packageName: launcherContext.launcherPackage,
    nodes: [
      {
        nodeId: 'node-wechat',
        role: 'button',
        text: '微信',
        contentDescription: '',
        resourceId: 'com.android.launcher3:id/icon',
        packageName: launcherContext.launcherPackage,
        clickable: true,
        editable: false,
        checked: false,
        visible: true,
        bounds: { left: 100, top: 200, right: 180, bottom: 280 },
        ancestorSignature: 'workspace>button',
      },
    ],
    nodeCount: 1,
    truncated: false,
    screenSignature: 'launcher-page-0',
  })
}

describe('LocalAppLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeAppLaunchMock.mockResolvedValue({ success: false, reason: 'no_intent' })
    launcherContextMock.mockResolvedValue(launcherContext)
    executeAccessibilityActionMock.mockImplementation((options: { action: string }) => {
      if (options.action === 'observeSemantic') return Promise.resolve({ success: true, output: snapshot() })
      if (options.action === 'global') return Promise.resolve({ success: true })
      if (options.action === 'clickNode') return Promise.resolve({ success: true, output: 'clicked' })
      return Promise.resolve({ success: false, reason: 'unsupported_test_action' })
    })
  })

  it('uses a verified placement after Intent failure without model or launcher swipes', async () => {
    const storage = new MemoryStorage()
    const launcher = new LocalAppLauncher({ storage, now: () => 1_000 })
    const cache = new (await import('./launcher-placement-cache')).LauncherPlacementCache({ storage, now: () => 1_000 })
    await cache.put({
      ...launcherContext,
      gridRows: 1,
      gridColumns: 1,
      packageName: app.packageName,
      activityName: app.activityName,
      pageIndex: 0,
      cellRow: 0,
      cellColumn: 0,
      bounds: { left: 100, top: 200, right: 180, bottom: 280 },
      confidence: 0.9,
      observedAt: 1_000,
      label: app.label,
      screenSignature: 'launcher-page-0',
    })

    const result = await launcher.launch(app, { taskId: 'task-1', toolCallId: 'call-1' })

    expect(result).toMatchObject({ success: true, method: 'verified_placement' })
    expect(executeAccessibilityActionMock.mock.calls.map(([options]) => options.action)).toEqual([
      'observeSemantic',
      'observeSemantic',
      'clickNode',
    ])
    expect(executeAccessibilityActionMock.mock.calls.map(([options]) => options.action)).not.toContain('swipe')
  })
})
