import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compactSemanticObservation,
  parseSemanticSnapshot,
  resetSemanticObservationCache,
  type SemanticNode,
  yachiyoDeviceAccessNative,
} from './yachiyo_device_access'

const nativePluginMock = vi.hoisted(() => ({
  accessibilityAction: vi.fn(),
  addListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => nativePluginMock),
}))

const node = (overrides: Partial<SemanticNode> = {}): SemanticNode => ({
  nodeId: 'node-1',
  role: 'button',
  text: 'Follow',
  contentDescription: '',
  resourceId: 'com.example:id/follow',
  packageName: 'com.example',
  clickable: true,
  editable: false,
  checked: false,
  visible: true,
  bounds: { left: 0, top: 0, right: 100, bottom: 80 },
  ...overrides,
})

const snapshot = (nodes: SemanticNode[], signature: string) =>
  JSON.stringify({
    version: 1,
    packageName: 'com.example',
    nodes,
    nodeCount: nodes.length,
    truncated: false,
    screenSignature: signature,
  })

describe('semantic observation compaction', () => {
  beforeEach(() => resetSemanticObservationCache())

  it('keeps the first snapshot and sends only subsequent changes', () => {
    const first = snapshot([node(), node({ nodeId: 'node-2', text: 'Settings' })], 'screen-1')
    expect(compactSemanticObservation(first, 'task-1')).toBe(first)

    const second = snapshot([node(), node({ nodeId: 'node-2', text: 'Preferences' })], 'screen-2')
    const parsed = parseSemanticSnapshot(compactSemanticObservation(second, 'task-1'))
    expect(parsed).toMatchObject({
      mode: 'diff',
      baseSignature: 'screen-1',
      screenSignature: 'screen-2',
      nodes: [{ nodeId: 'node-2', text: 'Preferences' }],
      removedNodeIds: [],
    })
  })

  it('reports removed node IDs without resending unchanged nodes', () => {
    compactSemanticObservation(snapshot([node(), node({ nodeId: 'node-2' })], 'screen-1'), 'task-1')
    const compact = compactSemanticObservation(snapshot([node()], 'screen-2'), 'task-1')
    expect(JSON.parse(compact)).toMatchObject({
      mode: 'diff',
      nodes: [],
      removedNodeIds: ['node-2'],
    })
  })

  it('validates the real native semantic node projection with the shared contract', () => {
    const nativeSnapshot = snapshot(
      [
        node({
          className: 'android.widget.Button',
          ancestorSignature: 'container>button#follow',
          sensitive: false,
          index: 0,
        }),
      ],
      'screen-native'
    )
    expect(parseSemanticSnapshot(nativeSnapshot)?.nodes[0]).toMatchObject({
      className: 'android.widget.Button',
      ancestorSignature: 'container>button#follow',
    })

    const invalidRole = JSON.parse(nativeSnapshot) as { nodes: Array<{ role: string }> }
    invalidRole.nodes[0].role = 'unsupported-role'
    expect(parseSemanticSnapshot(JSON.stringify(invalidRole))).toBeNull()
  })
})

describe('accessibility selector bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes selector text when scrolling a semantic node', async () => {
    nativePluginMock.accessibilityAction.mockResolvedValue({ success: true })
    await yachiyoDeviceAccessNative.scrollAccessibilityNode(
      { text: '娑堟伅鍒楄〃', resourceId: 'com.example:id/list' },
      'down'
    )
    expect(nativePluginMock.accessibilityAction).toHaveBeenCalledWith({
      action: 'scrollNode',
      packageName: undefined,
      resourceId: 'com.example:id/list',
      text: '娑堟伅鍒楄〃',
      contentDescription: undefined,
      role: undefined,
      ancestorSignature: undefined,
      direction: 'down',
    })
  })
})


