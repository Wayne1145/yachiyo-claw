import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import {
  type SemanticBounds,
  SemanticSnapshotSchema,
  type SemanticNode as SharedSemanticNode,
  type SemanticSnapshot as SharedSemanticSnapshot,
} from '@shared/agent'
import type { NativeSkillScriptOptions, RootCommandResult } from './yachiyo_agent'

export interface DevicePermissionStatus {
  overlay: boolean
  batteryOptimizationIgnored: boolean
  notificationsGranted: boolean
  autoStartSettingsAvailable: boolean
  deviceManufacturer: string
  allFiles: boolean
  accessibility: boolean
  shizukuInstalled: boolean
  shizukuRunning: boolean
  shizukuGranted: boolean
}

export type PermissionTarget =
  | 'overlay'
  | 'battery'
  | 'notifications'
  | 'autostart'
  | 'storage'
  | 'accessibility'
  | 'shizuku'
export type NativeApprovalDecision = 'once' | 'conversation' | 'deny'
export const MAX_SEMANTIC_BYTES = 16 * 1024

export type AccessibilityAction =
  | 'observe'
  | 'observeSemantic'
  | 'findNode'
  | 'clickNode'
  | 'setNodeText'
  | 'scrollNode'
  | 'tap'
  | 'swipe'
  | 'text'
  | 'global'
  | 'launch'

export interface AccessibilitySelector {
  packageName?: string
  resourceId?: string
  text?: string
  contentDescription?: string
  role?: string
  ancestorSignature?: string
}

export type AccessibilityNodeBounds = SemanticBounds
export type SemanticNode = SharedSemanticNode
export type SemanticSnapshot = SharedSemanticSnapshot

export interface LaunchableApp {
  packageName: string
  /** Native plugin name; launchActivity is the shared-contract name. */
  activityName?: string
  launchActivity?: string
  label: string
  aliases?: string[]
  versionCode?: number | string
  versionName?: string
  updatedAt?: number
}

export interface AccessibilityActionOptions {
  action: AccessibilityAction
  x?: number
  y?: number
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  duration?: number
  text?: string
  /** Text used to identify a node when the action also carries replacement text. */
  selectorText?: string
  key?: string
  packageName?: string
  activityName?: string
  resourceId?: string
  contentDescription?: string
  role?: string
  ancestorSignature?: string
  direction?: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward'
}

export interface AccessibilityActionResult {
  success: boolean
  found?: boolean
  ambiguous?: boolean
  output?: string
  node?: string
  method?: string
  reason?: string
  bytes?: number
}

export interface LaunchableAppsResult {
  apps: LaunchableApp[]
  count: number
  observedAt: number
}

export interface ResolveLaunchableAppResult {
  query: string
  matches: LaunchableApp[]
  selected?: LaunchableApp
  ambiguous: boolean
}

export interface LaunchableAppsChangedEvent {
  action: string
  packageName: string
  observedAt: number
}

export interface LauncherContext {
  launcherPackage: string
  launcherVersionCode: string | number
  displayId: number
  orientation: 'portrait' | 'landscape'
  density: number
  densityDpi?: number
  widthPixels?: number
  heightPixels?: number
}

/** Parse the bounded semantic payload without allowing malformed native data into the agent loop. */
export function parseSemanticSnapshot(output: string | undefined): SemanticSnapshot | null {
  if (!output) return null
  if (new TextEncoder().encode(output).byteLength > MAX_SEMANTIC_BYTES) return null
  try {
    const value: unknown = JSON.parse(output)
    const parsed = SemanticSnapshotSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const previousSemanticSnapshots = new Map<string, SemanticSnapshot>()

function semanticNodeFingerprint(node: SemanticNode): string {
  return JSON.stringify(node)
}

/**
 * Keep the first observation complete, then emit only changed/removed nodes.
 * If a delta is larger than the bounded native snapshot, the full snapshot is
 * retained instead.
 */
export function compactSemanticObservation(output: string, cacheKey = 'default'): string {
  const current = parseSemanticSnapshot(output)
  if (!current) return output
  const previous = previousSemanticSnapshots.get(cacheKey)
  previousSemanticSnapshots.delete(cacheKey)
  previousSemanticSnapshots.set(cacheKey, current)
  while (previousSemanticSnapshots.size > 8) {
    const oldest = previousSemanticSnapshots.keys().next().value as string | undefined
    if (!oldest) break
    previousSemanticSnapshots.delete(oldest)
  }
  if (!previous || previous.packageName !== current.packageName) return output

  const previousById = new Map(previous.nodes.map((node) => [node.nodeId, semanticNodeFingerprint(node)]))
  const currentIds = new Set(current.nodes.map((node) => node.nodeId))
  const changedNodes = current.nodes.filter((node) => previousById.get(node.nodeId) !== semanticNodeFingerprint(node))
  const removedNodeIds = previous.nodes.map((node) => node.nodeId).filter((nodeId) => !currentIds.has(nodeId))
  const delta: SemanticSnapshot = {
    ...current,
    mode: 'diff',
    baseSignature: previous.screenSignature,
    nodes: changedNodes,
    removedNodeIds,
  }
  const compact = JSON.stringify(delta)
  return new TextEncoder().encode(compact).byteLength < new TextEncoder().encode(output).byteLength ? compact : output
}

export function resetSemanticObservationCache(cacheKey?: string): void {
  if (cacheKey) previousSemanticSnapshots.delete(cacheKey)
  else previousSemanticSnapshots.clear()
}

interface YachiyoDeviceAccessNativePlugin {
  getPermissionStatus(): Promise<DevicePermissionStatus>
  openPermissionSettings(options: { target: PermissionTarget }): Promise<void>
  requestShizukuPermission(): Promise<{ granted: boolean }>
  execShizuku(options: { command: string; timeout: number }): Promise<RootCommandResult>
  execShizukuSkillScript(options: NativeSkillScriptOptions): Promise<RootCommandResult>
  requestSkillScriptAuthorization(options: NativeSkillScriptOptions): Promise<{ approvalNonce?: string; expiresAt?: number }>
  cancelShizukuScript(options: { executionId: string }): Promise<{ killed: boolean }>
  accessibilityAction(options: AccessibilityActionOptions): Promise<AccessibilityActionResult>
  launchApp?(options: { packageName: string; activityName?: string }): Promise<AccessibilityActionResult>
  listLaunchableApps(): Promise<LaunchableAppsResult>
  resolveLaunchableApp(options: { query: string }): Promise<ResolveLaunchableAppResult>
  getLauncherContext?(): Promise<LauncherContext>
  showOperationOverlay(options: { text: string }): Promise<void>
  updateOperationOverlay(options: { text: string }): Promise<void>
  hideOperationOverlay(): Promise<void>
  requestOperationApproval(options: {
    title: string
    detail: string
    dangerous: boolean
  }): Promise<{ decision: NativeApprovalDecision }>
  cancelOperationApproval(): Promise<void>
  bringAppToForeground(): Promise<void>
  addListener(eventName: 'overlayStopRequested', listener: () => void): Promise<PluginListenerHandle>
  addListener(
    eventName: 'launchableAppsChanged',
    listener: (event: LaunchableAppsChangedEvent) => void
  ): Promise<PluginListenerHandle>
}

const nativeAccess = registerPlugin<YachiyoDeviceAccessNativePlugin>('YachiyoDeviceAccess')

export const yachiyoDeviceAccessNative = {
  getPermissionStatus: () => nativeAccess.getPermissionStatus(),
  openPermissionSettings: (target: PermissionTarget) => nativeAccess.openPermissionSettings({ target }),
  requestShizukuPermission: () => nativeAccess.requestShizukuPermission(),
  execShizuku: (command: string, timeout = 120_000) => nativeAccess.execShizuku({ command, timeout }),
  execShizukuSkillScript: (options: NativeSkillScriptOptions) => nativeAccess.execShizukuSkillScript(options),
  requestSkillScriptAuthorization: (options: NativeSkillScriptOptions) => nativeAccess.requestSkillScriptAuthorization(options),
  cancelShizukuScript: (executionId: string) => nativeAccess.cancelShizukuScript({ executionId }),
  accessibilityAction: (options: AccessibilityActionOptions) => nativeAccess.accessibilityAction(options),
  launchApp: (packageName: string, activityName?: string) =>
    nativeAccess.launchApp
      ? nativeAccess.launchApp({ packageName, activityName })
      : nativeAccess.accessibilityAction({ action: 'launch', packageName, activityName }),
  observeSemantic: () => nativeAccess.accessibilityAction({ action: 'observeSemantic' }),
  findAccessibilityNode: (selector: AccessibilitySelector) =>
    nativeAccess.accessibilityAction({
      action: 'findNode',
      packageName: selector.packageName,
      resourceId: selector.resourceId,
      text: selector.text,
      contentDescription: selector.contentDescription,
      role: selector.role,
      ancestorSignature: selector.ancestorSignature,
    }),
  clickAccessibilityNode: (selector: AccessibilitySelector) =>
    nativeAccess.accessibilityAction({
      action: 'clickNode',
      packageName: selector.packageName,
      resourceId: selector.resourceId,
      text: selector.text,
      contentDescription: selector.contentDescription,
      role: selector.role,
      ancestorSignature: selector.ancestorSignature,
    }),
  setAccessibilityNodeText: (selector: AccessibilitySelector, text: string) =>
    nativeAccess.accessibilityAction({
      action: 'setNodeText',
      packageName: selector.packageName,
      resourceId: selector.resourceId,
      text,
      selectorText: selector.text,
      contentDescription: selector.contentDescription,
      role: selector.role,
      ancestorSignature: selector.ancestorSignature,
    }),
  scrollAccessibilityNode: (selector: AccessibilitySelector, direction: AccessibilityActionOptions['direction']) =>
    nativeAccess.accessibilityAction({
      action: 'scrollNode',
      packageName: selector.packageName,
      resourceId: selector.resourceId,
      text: selector.text,
      contentDescription: selector.contentDescription,
      role: selector.role,
      ancestorSignature: selector.ancestorSignature,
      direction,
    }),
  listLaunchableApps: () => nativeAccess.listLaunchableApps(),
  resolveLaunchableApp: (query: string) => nativeAccess.resolveLaunchableApp({ query }),
  getLauncherContext: () =>
    nativeAccess.getLauncherContext
      ? nativeAccess.getLauncherContext()
      : Promise.reject(new Error('launcher_context_unavailable')),
  showOperationOverlay: (text = '') => nativeAccess.showOperationOverlay({ text }),
  updateOperationOverlay: (text: string) => nativeAccess.updateOperationOverlay({ text }),
  hideOperationOverlay: () => nativeAccess.hideOperationOverlay(),
  requestOperationApproval: (title: string, detail: string, dangerous: boolean) =>
    nativeAccess.requestOperationApproval({ title, detail, dangerous }),
  cancelOperationApproval: () => nativeAccess.cancelOperationApproval(),
  bringAppToForeground: () => nativeAccess.bringAppToForeground(),
  onOverlayStopRequested: (listener: () => void) => nativeAccess.addListener('overlayStopRequested', listener),
  onLaunchableAppsChanged: (listener: (event: LaunchableAppsChangedEvent) => void) =>
    nativeAccess.addListener('launchableAppsChanged', listener),
}
