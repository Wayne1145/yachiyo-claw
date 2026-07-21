import type { ProviderModelInfo } from '../../types'

export const YACHIYO_GPT_CHAT_CAPABILITIES: NonNullable<ProviderModelInfo['capabilities']> = [
  'vision',
  'tool_use',
  'reasoning',
]

const YACHIYO_DEFAULT_CHAT_CAPABILITIES: NonNullable<ProviderModelInfo['capabilities']> = ['tool_use']
const NON_CHAT_MODEL_ID = /(?:^|[-_.])(image|embedding|embed|rerank(?:er)?)(?:[-_.]|$)/i

function isChatModel(model: ProviderModelInfo): boolean {
  return (!model.type || model.type === 'chat') && !NON_CHAT_MODEL_ID.test(model.modelId)
}

function mergeCapabilities(
  current: ProviderModelInfo['capabilities'],
  inferred: NonNullable<ProviderModelInfo['capabilities']>
): NonNullable<ProviderModelInfo['capabilities']> {
  return [...new Set([...(current || []), ...inferred])]
}

/** Adds product-known capabilities without discarding metadata returned by the API. */
export function normalizeYachiyoModel(model: ProviderModelInfo): ProviderModelInfo {
  if (!isChatModel(model)) return model

  const inferred = /^gpt(?:-|$)/i.test(model.modelId)
    ? YACHIYO_GPT_CHAT_CAPABILITIES
    : model.capabilities?.length
      ? []
      : YACHIYO_DEFAULT_CHAT_CAPABILITIES

  if (inferred.length === 0) return model
  return {
    ...model,
    capabilities: mergeCapabilities(model.capabilities, inferred),
  }
}

export function normalizeYachiyoModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
  return models.map(normalizeYachiyoModel)
}
