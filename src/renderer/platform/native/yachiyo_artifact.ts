import { registerPlugin } from '@capacitor/core'
import { createFeatureGatedPlugin } from './feature-gated-plugin'

export interface NativeApkInspection {
  path: string
  size: number
  sha256: string
  packageName: string
  versionName?: string
  versionCode: number
  signerSha256: string
  permissions: string[]
  installed: boolean
  signatureMatchesInstalled: boolean
  hostPackageBlocked: boolean
}

interface NativeArtifactPlugin {
  inspectApk(options: { workspaceKey: string; path: string }): Promise<NativeApkInspection>
  installApk(options: { workspaceKey: string; path: string; expectedSha256: string }): Promise<{ accepted: boolean; packageName: string; sha256: string }>
  packageStatus(options: { packageName: string }): Promise<{ installed: boolean; packageName: string; versionName?: string; versionCode?: number }>
  launchPackage(options: { packageName: string }): Promise<{ launched: boolean }>
  installPermission(): Promise<{ allowed: boolean }>
  openInstallPermission(): Promise<{ opened: boolean }>
}

export const yachiyoArtifactNative = createFeatureGatedPlugin(
  'mobile-vibe-coding-v1',
  registerPlugin<NativeArtifactPlugin>('YachiyoArtifact'),
)
