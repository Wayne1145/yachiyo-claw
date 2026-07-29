import { TOOL_IDS } from '@shared/agent/tool-ids'
import type { FeatureManifest } from '@shared/features/contract'
import { hasFeature, registerFeature } from '@shared/features/registry'

const ALL_PLATFORMS = ['android', 'desktop', 'web'] as const

const DEVICE_TOOL_IDS = Object.values(TOOL_IDS).filter((id) => !id.startsWith('agent.schedule.'))
const SCHEDULE_TOOL_IDS = [TOOL_IDS.SCHEDULE_CREATE, TOOL_IDS.SCHEDULE_LIST, TOOL_IDS.SCHEDULE_CANCEL]

export const BUILTIN_FEATURES: readonly FeatureManifest[] = [
  {
    id: 'core-agent',
    displayName: 'Agent runtime',
    description: 'Core model operating rules and Agent loop integration.',
    platforms: ALL_PLATFORMS,
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'mcp',
    displayName: 'MCP',
    description: 'Connects approved external Model Context Protocol servers.',
    platforms: ALL_PLATFORMS,
    trust: 'sandboxed',
    enabledByDefault: true,
  },
  {
    id: 'knowledge-base',
    displayName: 'Knowledge base',
    description: 'Desktop knowledge-base retrieval tools.',
    platforms: ['desktop'],
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'session-attachment-rag',
    displayName: 'Session attachment retrieval',
    description: 'Retrieves relevant chunks from indexed conversation attachments.',
    platforms: ALL_PLATFORMS,
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'file',
    displayName: 'Conversation files',
    description: 'Reads files and links explicitly attached to a conversation.',
    platforms: ALL_PLATFORMS,
    trust: 'sandboxed',
    enabledByDefault: true,
  },
  {
    id: 'web-search',
    displayName: 'Web search',
    description: 'Searches the web through the configured provider.',
    platforms: ALL_PLATFORMS,
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'sandbox',
    displayName: 'Local development environment',
    description: 'Runs coding tools in the controlled Linux workspace.',
    platforms: ALL_PLATFORMS,
    trust: 'sandboxed',
    enabledByDefault: true,
    nativePlugins: ['YachiyoSandbox'],
  },
  {
    id: 'workspace',
    displayName: 'Workspace delivery',
    description: 'Mounts, previews, exports, and delivers workspace projects.',
    platforms: ['android'],
    trust: 'sandboxed',
    requires: ['sandbox'],
    enabledByDefault: true,
    nativePlugins: ['YachiyoWorkspace'],
  },
  {
    id: 'mobile-vibe-coding-v1',
    displayName: 'Mobile Vibe Coding',
    description: 'Creates, reviews, builds, previews, and delivers projects on Android.',
    platforms: ['android'],
    trust: 'sandboxed',
    requires: ['sandbox', 'workspace'],
    enabledByDefault: true,
    nativePlugins: ['YachiyoSandbox', 'YachiyoWorkspace', 'YachiyoArtifact'],
  },
  {
    id: 'android-device',
    displayName: 'Phone control',
    description: 'Controls the Android device through the Tool Broker and approved backends.',
    platforms: ['android'],
    trust: 'privileged',
    enabledByDefault: true,
    toolIds: DEVICE_TOOL_IDS,
    androidPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
    nativePlugins: ['YachiyoAgent', 'YachiyoDeviceAccess'],
  },
  {
    id: 'long-term-memory',
    displayName: 'User and memory',
    description: 'Stores and retrieves durable user context through encrypted Android storage.',
    platforms: ALL_PLATFORMS,
    trust: 'inert',
    enabledByDefault: true,
    nativePlugins: ['YachiyoMemory'],
  },
  {
    id: 'camera',
    displayName: 'Camera',
    description: 'Provides user-enabled camera captures to an interactive conversation.',
    platforms: ALL_PLATFORMS,
    trust: 'privileged',
    enabledByDefault: true,
    androidPermissions: ['android.permission.CAMERA'],
  },
  {
    id: 'skills',
    displayName: 'Skills',
    description: 'Loads reusable instructions and executes approved scripts in the sandbox.',
    platforms: ALL_PLATFORMS,
    trust: 'sandboxed',
    enabledByDefault: true,
  },
  {
    id: 'plugins',
    displayName: 'Third-party plugins',
    description: 'Installs and runs consent-gated third-party extensions in an isolated runtime.',
    // The opaque data-document Worker bridge is compatible with Android WebView while preserving
    // the same no-storage/no-egress CSP and Host-call authorization boundary on every platform.
    platforms: ALL_PLATFORMS,
    trust: 'sandboxed',
    enabledByDefault: true,
    nativePlugins: ['YachiyoPluginNetwork', 'YachiyoSecureStorage', 'YachiyoDownloads'],
  },
  {
    id: 'interactive',
    displayName: 'Interactive',
    description: 'Live2D, voice, and camera-assisted real-time conversation.',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'tasks',
    displayName: 'Scheduled tasks',
    description: 'Creates and resumes scheduled Agent work.',
    platforms: ['android'],
    trust: 'privileged',
    enabledByDefault: true,
    toolIds: SCHEDULE_TOOL_IDS,
    nativePlugins: ['YachiyoScheduler'],
  },
  {
    id: 'local-models',
    displayName: 'Local models',
    description: 'Downloads and runs supported models on the Android device.',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
    nativePlugins: ['YachiyoModelManager'],
  },
  {
    id: 'speech',
    displayName: 'Speech services',
    description: 'Speech recognition and text-to-speech providers.',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
    androidPermissions: ['android.permission.RECORD_AUDIO'],
    nativePlugins: ['YachiyoVoice'],
  },
  {
    id: 'character-profiles',
    displayName: 'Character profiles',
    description: 'Personality, avatar, Live2D, voice, and model presets.',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
  },
  {
    id: 'updater',
    displayName: 'Application updates',
    description: 'Checks, downloads, and installs signed Yachiyo Claw releases.',
    platforms: ['android'],
    trust: 'privileged',
    enabledByDefault: true,
    nativePlugins: ['YachiyoUpdate'],
  },
] as const

/** Registration checks the live map, so test resets and hot reloads remain safe. */
export function registerBuiltinFeatures(): void {
  for (const manifest of BUILTIN_FEATURES) {
    if (!hasFeature(manifest.id)) registerFeature(manifest)
  }
}
