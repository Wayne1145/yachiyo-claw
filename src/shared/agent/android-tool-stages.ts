import type { ModelMessage } from 'ai'

export const ANDROID_TOOL_STAGE_INITIAL = [
  'android_device_info',
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

export type AndroidToolStage = 'initial' | 'stable' | 'fallback' | 'complete'

function serializedToolMessages(messages: readonly ModelMessage[]): string {
  try {
    return JSON.stringify(messages.filter((message) => message.role === 'tool')).toLowerCase()
  } catch {
    return ''
  }
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
  if (requested?.length && stepNumber <= 0) return [...new Set(requested)]
  const androidToolNames = new Set<string>(ANDROID_TOOL_STAGE_FALLBACK)
  const internalTools = (requested ?? []).filter((name) => !androidToolNames.has(name))
  const stage = selectAndroidToolStage(stepNumber, messages)
  const androidTools =
    stage === 'complete'
      ? ['android_observe']
      : stage === 'fallback'
        ? [...ANDROID_TOOL_STAGE_FALLBACK]
        : stage === 'stable'
          ? [...ANDROID_TOOL_STAGE_STABLE]
          : [...ANDROID_TOOL_STAGE_INITIAL]
  return [...new Set([...internalTools, ...androidTools])]
}
