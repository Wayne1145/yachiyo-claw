import type { ModelMessage } from 'ai'

export const ANDROID_TOOL_STAGE_INITIAL = [
  'android_device_info',
  'android_permission_status',
  'android_app_list',
  'android_observe',
  'android_launch_app',
  'android_run_recipe',
] as const

export const ANDROID_TOOL_STAGE_STABLE = [
  ...ANDROID_TOOL_STAGE_INITIAL,
  'android_find_node',
  'android_click_node',
  'android_set_node_text',
  'android_scroll_node',
] as const

export const ANDROID_TOOL_STAGE_FALLBACK = [
  ...ANDROID_TOOL_STAGE_STABLE,
  'android_tap',
  'android_swipe',
  'android_type_text',
  'android_keyevent',
  'android_companion_action',
] as const

/** Large observation payloads that may be pruned once newer observations exist. */
export const ANDROID_PRUNABLE_TOOL_RESULTS = ['android_observe'] as const

export type AndroidToolStage = 'initial' | 'stable' | 'fallback' | 'complete'

function serializedToolMessages(messages: readonly ModelMessage[]): string {
  try {
    return JSON.stringify(messages.filter((message) => message.role === 'tool')).toLowerCase()
  } catch {
    return ''
  }
}

function serializedUserMessages(messages: readonly ModelMessage[]): string {
  try {
    return JSON.stringify(messages.filter((message) => message.role === 'user')).toLowerCase()
  } catch {
    return ''
  }
}

const CODING_INTENT =
  /(?:html|css|javascript|typescript|python|node(?:\.js)?|代码|编程|网页|网站|小游戏|项目|部署|端口|localhost|server|服务器)/i
const UBUNTU_INTENT = /(?:ubuntu|apt(?:-get)?|\.deb\b|glibc)/i
const SIMPLE_WEB_PREVIEW_INTENT =
  /(?:html|网页|网站|小游戏).*(?:部署|端口|localhost|server|服务器)|(?:部署|端口|localhost).*(?:html|网页|网站|小游戏)/i

const SIMPLE_WEB_PREVIEW_TOOLS = new Set([
  'agent_environment_status',
  'agent_complete',
  'agent_blocked',
  'sandbox_bash',
  'sandbox_read',
  'sandbox_write',
  'sandbox_edit',
  'sandbox_ls',
  'sandbox_start_background',
  'sandbox_job_status',
  'sandbox_job_output',
  'sandbox_stop_job',
  'workspace_preview',
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
])

function selectInternalToolsForIntent(
  messages: readonly ModelMessage[],
  requested: readonly string[],
): string[] {
  const userText = serializedUserMessages(messages)
  if (!CODING_INTENT.test(userText)) return [...requested]

  if (SIMPLE_WEB_PREVIEW_INTENT.test(userText) && !UBUNTU_INTENT.test(userText)) {
    return requested.filter((name) => SIMPLE_WEB_PREVIEW_TOOLS.has(name))
  }

  // Coding turns otherwise expose every enabled Skill, MCP and plugin schema.
  // Keep the focused authoring/preview surface so small mobile models and slow
  // upstream streams can choose a tool promptly and reliably.
  const selected = requested.filter((name) =>
    name.startsWith('agent_') ||
    name.startsWith('sandbox_') ||
    name.startsWith('workspace_') ||
    name.startsWith('coding_') ||
    name.startsWith('browser_') ||
    name === 'web_search' ||
    name === 'parse_link'
  )

  if (UBUNTU_INTENT.test(userText)) {
    selected.push(...requested.filter((name) => name.startsWith('ubuntu-runtime_')))
  }
  return [...new Set(selected)]
}

export function selectAndroidToolStage(stepNumber: number, messages: readonly ModelMessage[]): AndroidToolStage {
  if (stepNumber <= 0) return 'initial'
  const text = serializedToolMessages(messages)
  if (/(recipe_verified|recipe_applied|verification_succeeded|"status":"verified")/.test(text)) return 'complete'
  if (/(semantic_nodes_require|node_not_found|selector|fallback|required|failed|error)/.test(text)) return 'fallback'
  return 'stable'
}

export function selectAndroidActiveTools(
  stepNumber: number,
  messages: readonly ModelMessage[],
  requested?: readonly string[],
): string[] {
  const androidToolNames = new Set<string>(ANDROID_TOOL_STAGE_FALLBACK)
  const includeAndroidTools = requested === undefined || requested.some((name) => androidToolNames.has(name))
  const internalTools = selectInternalToolsForIntent(
    messages,
    (requested ?? []).filter((name) => !androidToolNames.has(name)),
  )
  const stage = selectAndroidToolStage(stepNumber, messages)
  const androidTools = !includeAndroidTools
    ? []
    : stage === 'complete'
      ? ['android_observe']
      : stage === 'fallback'
        ? [...ANDROID_TOOL_STAGE_FALLBACK]
        : stage === 'stable'
          ? [...ANDROID_TOOL_STAGE_STABLE]
          : [...ANDROID_TOOL_STAGE_INITIAL]
  return [...new Set([...internalTools, ...androidTools])]
}

export function resolveAgentActiveTools(
  stepNumber: number,
  messages: readonly ModelMessage[],
  requested: readonly string[] | undefined,
  available: readonly string[] | undefined,
): string[] | undefined {
  const actual = requested ?? available
  if (!actual?.length) return undefined
  return selectAndroidActiveTools(stepNumber, messages, actual)
}
