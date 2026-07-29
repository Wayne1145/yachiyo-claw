import { z } from 'zod'

export const BuildTargetIdSchema = z.enum([
  'web-static',
  'web-vite',
  'web-pwa',
  'android-capacitor',
  'android-kotlin',
  'android-compose',
  'node',
  'python',
  'linux-arm64',
  'source-mobile-native',
  'browser-extension',
  'windows',
  'macos',
  'ios',
  'linux-x64',
  'docker',
])
export type BuildTargetId = z.infer<typeof BuildTargetIdSchema>

export const CodingSupportLevelSchema = z.enum(['stable', 'beta', 'source-only', 'remote-only'])
export type CodingSupportLevel = z.infer<typeof CodingSupportLevelSchema>
export type CodingVerificationMode =
  | 'local-build-and-verify'
  | 'local-source-only'
  | 'remote-build-required'
  | 'unsupported'

export interface BuildTargetProfile {
  id: BuildTargetId
  label: string
  category: 'web' | 'android' | 'runtime' | 'remote'
  supportLevel: CodingSupportLevel
  verification: CodingVerificationMode
  templateId?: string
  requirements: Array<'sandbox' | 'node' | 'python' | 'build-base' | 'android-sdk'>
  minimumFreeBytes: number
  recommendedFreeBytes: number
  buildCommand: string
  testCommand?: string
  installCommand?: string
  artifactPatterns: string[]
  preview: 'webview' | 'android-install' | 'terminal' | 'none'
  delivery: 'share' | 'install-apk' | 'remote-build'
}

const GB = 1024 ** 3

export const BUILD_TARGET_PROFILES: readonly BuildTargetProfile[] = [
  { id: 'web-static', label: 'Static Web', category: 'web', supportLevel: 'stable', verification: 'local-build-and-verify', templateId: 'static-web-v1', requirements: ['sandbox'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: "test -f index.html", artifactPatterns: ['index.html'], preview: 'webview', delivery: 'share' },
  { id: 'web-vite', label: 'Vite + TypeScript', category: 'web', supportLevel: 'stable', verification: 'local-build-and-verify', templateId: 'vite-ts-v1', requirements: ['sandbox', 'node'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, installCommand: 'npm install', buildCommand: 'npm run build', testCommand: 'npm run check', artifactPatterns: ['dist/**'], preview: 'webview', delivery: 'share' },
  { id: 'web-pwa', label: 'Vite PWA', category: 'web', supportLevel: 'stable', verification: 'local-build-and-verify', templateId: 'vite-pwa-v1', requirements: ['sandbox', 'node'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, installCommand: 'npm install', buildCommand: 'npm run build', testCommand: 'npm run check', artifactPatterns: ['dist/**'], preview: 'webview', delivery: 'share' },
  { id: 'android-capacitor', label: 'Capacitor Android APK', category: 'android', supportLevel: 'stable', verification: 'local-build-and-verify', templateId: 'capacitor-v1', requirements: ['sandbox', 'node', 'android-sdk'], minimumFreeBytes: 4 * GB, recommendedFreeBytes: 8 * GB, installCommand: 'npm install && npx cap add android', buildCommand: 'npm run build && npx cap sync android && cd android && ./gradlew assembleDebug', testCommand: 'npm run check', artifactPatterns: ['android/app/build/outputs/apk/debug/*.apk'], preview: 'android-install', delivery: 'install-apk' },
  { id: 'android-kotlin', label: 'Kotlin Android Views', category: 'android', supportLevel: 'beta', verification: 'local-build-and-verify', templateId: 'kotlin-views-v1', requirements: ['sandbox', 'android-sdk'], minimumFreeBytes: 4 * GB, recommendedFreeBytes: 8 * GB, installCommand: 'gradle wrapper', buildCommand: './gradlew assembleDebug', testCommand: './gradlew testDebugUnitTest', artifactPatterns: ['app/build/outputs/apk/debug/*.apk'], preview: 'android-install', delivery: 'install-apk' },
  { id: 'android-compose', label: 'Jetpack Compose', category: 'android', supportLevel: 'beta', verification: 'local-source-only', requirements: ['sandbox', 'android-sdk'], minimumFreeBytes: 4 * GB, recommendedFreeBytes: 8 * GB, buildCommand: './gradlew assembleDebug', artifactPatterns: ['app/build/outputs/apk/debug/*.apk'], preview: 'none', delivery: 'share' },
  { id: 'node', label: 'Node.js', category: 'runtime', supportLevel: 'stable', verification: 'local-build-and-verify', requirements: ['sandbox', 'node'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: 'npm test', artifactPatterns: [], preview: 'terminal', delivery: 'share' },
  { id: 'python', label: 'Python', category: 'runtime', supportLevel: 'stable', verification: 'local-build-and-verify', requirements: ['sandbox', 'python'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: 'python3 -m compileall .', artifactPatterns: [], preview: 'terminal', delivery: 'share' },
  { id: 'linux-arm64', label: 'Linux ARM64 CLI', category: 'runtime', supportLevel: 'stable', verification: 'local-build-and-verify', requirements: ['sandbox', 'build-base'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: 'make', artifactPatterns: [], preview: 'terminal', delivery: 'share' },
  { id: 'source-mobile-native', label: 'React Native / Flutter / Android NDK', category: 'android', supportLevel: 'source-only', verification: 'local-source-only', requirements: ['sandbox'], minimumFreeBytes: GB, recommendedFreeBytes: 4 * GB, buildCommand: '', artifactPatterns: [], preview: 'none', delivery: 'share' },
  { id: 'browser-extension', label: 'Browser Extension', category: 'web', supportLevel: 'source-only', verification: 'local-source-only', requirements: ['sandbox', 'node'], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: 'npm run build', artifactPatterns: ['dist/**'], preview: 'none', delivery: 'share' },
  ...(['windows', 'macos', 'ios', 'linux-x64', 'docker'] as const).map((id) => ({ id, label: id === 'linux-x64' ? 'Linux x86_64' : id[0].toUpperCase() + id.slice(1), category: 'remote' as const, supportLevel: 'remote-only' as const, verification: 'remote-build-required' as const, requirements: ['sandbox' as const], minimumFreeBytes: GB, recommendedFreeBytes: 2 * GB, buildCommand: '', artifactPatterns: [], preview: 'none' as const, delivery: 'remote-build' as const })),
]

export function getBuildTargetProfile(id: BuildTargetId): BuildTargetProfile {
  const profile = BUILD_TARGET_PROFILES.find((candidate) => candidate.id === id)
  if (!profile) throw new Error(`coding_target_unknown:${id}`)
  return profile
}

export const CodingProjectRecordSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), taskId: z.string(), name: z.string().min(1).max(128),
  targetId: BuildTargetIdSchema, supportLevel: CodingSupportLevelSchema,
  source: z.object({ kind: z.enum(['template', 'saf']), templateId: z.string().optional() }),
  workspaceKey: z.string(),
  buildConfig: z.object({ installCommand: z.string().optional(), buildCommand: z.string(), testCommand: z.string().optional(), artifactPatterns: z.array(z.string()) }),
  status: z.enum(['creating', 'ready', 'changing', 'building', 'failed']), dirtyExternalSync: z.boolean(),
  createdAt: z.number(), updatedAt: z.number(),
})
export type CodingProjectRecord = z.infer<typeof CodingProjectRecordSchema>

export const CodingChangeOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), path: z.string(), content: z.string() }),
  z.object({ kind: z.literal('update'), path: z.string(), content: z.string(), baseSha256: z.string(), baseContent: z.string().optional() }),
  z.object({ kind: z.literal('delete'), path: z.string(), baseSha256: z.string(), baseContent: z.string().optional() }),
])
export type CodingChangeOperation = z.infer<typeof CodingChangeOperationSchema>

export const CodingChangeSetSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), projectId: z.string(), objective: z.string(),
  operations: z.array(CodingChangeOperationSchema).max(200),
  state: z.enum(['pending', 'approved', 'applying', 'applied', 'rejected', 'conflict', 'failed', 'reverted']),
  createdAt: z.number(), updatedAt: z.number(), error: z.string().optional(),
})
export type CodingChangeSet = z.infer<typeof CodingChangeSetSchema>

export const CodingBuildRunSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), projectId: z.string(), kind: z.enum(['install', 'build', 'test', 'preview']),
  command: z.string(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'needs-check']),
  nativeJobId: z.string().optional(), exitCode: z.number().nullable().optional(), logRef: z.string().optional(),
  startedAt: z.number(), completedAt: z.number().optional(),
})
export type CodingBuildRun = z.infer<typeof CodingBuildRunSchema>

export const CodingArtifactSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), projectId: z.string(), buildRunId: z.string(),
  type: z.enum(['apk', 'web', 'zip', 'binary']), path: z.string(), size: z.number(), sha256: z.string(),
  state: z.enum(['built', 'inspected', 'installed', 'verified', 'failed']), packageName: z.string().optional(),
  versionName: z.string().optional(), signerSha256: z.string().optional(), permissions: z.array(z.string()).optional(), createdAt: z.number(),
})
export type CodingArtifact = z.infer<typeof CodingArtifactSchema>

export interface ToolchainCapabilitySnapshot {
  abi: string
  freeBytes: number
  sandboxReady: boolean
  androidToolchainReady: boolean
  androidToolchainSupported: boolean
  node: boolean
  python: boolean
  buildBase: boolean
  jdk: boolean
  gradle: boolean
  androidSdk: boolean
  aapt2: boolean
  capturedAt: number
}

export interface RemoteBuildProvider {
  id: string
  supportedTargets: BuildTargetId[]
  submit(project: CodingProjectRecord): Promise<{ runId: string }>
  status(runId: string): Promise<CodingBuildRun>
  cancel(runId: string): Promise<void>
  artifacts(runId: string): Promise<CodingArtifact[]>
}

/** V1 intentionally ships without a remote runner implementation. */
export const REMOTE_BUILD_PROVIDERS: readonly RemoteBuildProvider[] = []

export function findRemoteBuildProvider(targetId: BuildTargetId): RemoteBuildProvider | null {
  return REMOTE_BUILD_PROVIDERS.find((provider) => provider.supportedTargets.includes(targetId)) ?? null
}
