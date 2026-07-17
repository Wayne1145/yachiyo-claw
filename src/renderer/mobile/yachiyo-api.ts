import { fetchRemoteModels } from '@shared/models/openai-compatible'
import { YACHIYO_API_HOST } from '@shared/providers/definitions/yachiyo'
import type { ProviderModelInfo } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { createModelDependencies } from '@/adapters'

const YACHIYO_MODELS_API_HOST = YACHIYO_API_HOST

export async function fetchYachiyoModels(
  apiKey: string,
  dependencies?: ModelDependencies
): Promise<ProviderModelInfo[]> {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) {
    throw new Error('api_key_required')
  }

  return fetchRemoteModels(
    {
      apiHost: YACHIYO_MODELS_API_HOST,
      apiKey: normalizedApiKey,
    },
    dependencies || (await createModelDependencies())
  )
}
