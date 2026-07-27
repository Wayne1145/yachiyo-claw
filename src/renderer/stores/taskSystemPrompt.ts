import type { ModelInterface } from '@shared/models/types'
import { registerBuiltinPromptBlocks } from '@/features/builtin-prompt-blocks'
import { renderPromptBlocks } from '@/features/prompt-registry'

export interface TaskSystemPromptOptions {
  agentIdentity?: string
  deviceAgent?: boolean
  enabledFeatureIds?: ReadonlySet<string>
}

export function buildTaskSystemPrompt(workingDirectory: string, options: TaskSystemPromptOptions = {}): string {
  registerBuiltinPromptBlocks()
  const featurePrompt = renderPromptBlocks('agent-system', {
    model: {} as ModelInterface,
    messages: [],
    platformType: 'mobile',
    enabledFeatureIds: options.enabledFeatureIds,
    featureOptions: {
      sandbox: { workingDirectory },
      'android-device': { deviceAgent: options.deviceAgent },
    },
  })
  return [options.agentIdentity, featurePrompt].filter(Boolean).join('\n\n')
}
