import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import type { RootCommandResult } from './yachiyo_agent'

export interface DevicePermissionStatus {
  overlay: boolean
  batteryOptimizationIgnored: boolean
  allFiles: boolean
  accessibility: boolean
  shizukuInstalled: boolean
  shizukuRunning: boolean
  shizukuGranted: boolean
}

export type PermissionTarget = 'overlay' | 'battery' | 'storage' | 'accessibility' | 'shizuku'
export type NativeApprovalDecision = 'once' | 'conversation' | 'deny'

interface AccessibilityActionOptions {
  action: 'observe' | 'tap' | 'swipe' | 'text' | 'global' | 'launch'
  x?: number
  y?: number
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  duration?: number
  text?: string
  key?: string
  packageName?: string
}

interface YachiyoDeviceAccessNativePlugin {
  getPermissionStatus(): Promise<DevicePermissionStatus>
  openPermissionSettings(options: { target: PermissionTarget }): Promise<void>
  requestShizukuPermission(): Promise<{ granted: boolean }>
  execShizuku(options: { command: string; timeout: number }): Promise<RootCommandResult>
  accessibilityAction(options: AccessibilityActionOptions): Promise<{ success: boolean; output?: string }>
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
}

const nativeAccess = registerPlugin<YachiyoDeviceAccessNativePlugin>('YachiyoDeviceAccess')

export const yachiyoDeviceAccessNative = {
  getPermissionStatus: () => nativeAccess.getPermissionStatus(),
  openPermissionSettings: (target: PermissionTarget) => nativeAccess.openPermissionSettings({ target }),
  requestShizukuPermission: () => nativeAccess.requestShizukuPermission(),
  execShizuku: (command: string, timeout = 120_000) => nativeAccess.execShizuku({ command, timeout }),
  accessibilityAction: (options: AccessibilityActionOptions) => nativeAccess.accessibilityAction(options),
  showOperationOverlay: (text = '') => nativeAccess.showOperationOverlay({ text }),
  updateOperationOverlay: (text: string) => nativeAccess.updateOperationOverlay({ text }),
  hideOperationOverlay: () => nativeAccess.hideOperationOverlay(),
  requestOperationApproval: (title: string, detail: string, dangerous: boolean) =>
    nativeAccess.requestOperationApproval({ title, detail, dangerous }),
  cancelOperationApproval: () => nativeAccess.cancelOperationApproval(),
  bringAppToForeground: () => nativeAccess.bringAppToForeground(),
  onOverlayStopRequested: (listener: () => void) => nativeAccess.addListener('overlayStopRequested', listener),
}
