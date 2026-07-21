import {
  HuggingFaceModelCatalogAdapter,
  ModelCatalogController,
  ModelScopeModelCatalogAdapter,
  type ModelCatalogControllerOptions,
  type ModelCatalogSource,
  type ModelSearchOptions,
  type RemoteModel,
} from '@shared/models/model-catalog'
import { createNativeModelDownloadSink } from '@/platform/native/yachiyo_model_manager'
import { fetchWithProxy } from '@/utils/request'

export const MOBILE_MODEL_SEARCH_TIMEOUT_MS: Record<ModelCatalogSource, number> = {
  huggingface: 12_000,
  modelscope: 10_000,
}

export interface MobileModelSearchResult {
  models: RemoteModel[]
  failures: Array<{ source: ModelCatalogSource; error: unknown }>
}

interface MobileModelSearchConfig {
  signal?: AbortSignal
  timeoutMs?: Partial<Record<ModelCatalogSource, number>>
}

async function searchSourceWithDeadline(
  controller: ModelCatalogController,
  source: ModelCatalogSource,
  options: ModelSearchOptions,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<RemoteModel[]> {
  const child = new AbortController()
  let rejectCancellation: ((reason: Error) => void) | undefined
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  const abortFromParent = () => {
    child.abort()
    rejectCancellation?.(new Error(`model_catalog_${source}_cancelled`))
  }
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    child.abort()
    rejectCancellation?.(new Error(`model_catalog_${source}_timeout`))
  }, Math.max(1, timeoutMs))
  try {
    // Bound custom/native fetch implementations even if they ignore AbortSignal.
    return await Promise.race([controller.search(source, { ...options, signal: child.signal }), cancellation])
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

export async function searchMobileModelCatalog(
  controller: ModelCatalogController,
  sources: ModelCatalogSource[],
  options: ModelSearchOptions,
  config: MobileModelSearchConfig = {},
): Promise<MobileModelSearchResult> {
  const settled = await Promise.all(
    sources.map(async (source) => {
      try {
        const models = await searchSourceWithDeadline(
          controller,
          source,
          options,
          config.timeoutMs?.[source] ?? MOBILE_MODEL_SEARCH_TIMEOUT_MS[source],
          config.signal,
        )
        return { source, models, error: undefined }
      } catch (error) {
        return { source, models: [] as RemoteModel[], error }
      }
    }),
  )
  return {
    models: settled.flatMap((result) => result.models),
    failures: settled
      .filter((result) => result.error !== undefined)
      .map((result) => ({ source: result.source, error: result.error })),
  }
}

/**
 * Mobile catalog facade: metadata stays in the shared adapters while lifecycle
 * commands are handed to the native WorkManager bridge by identifier only.
 */
export function createMobileModelCatalogController(options: ModelCatalogControllerOptions = {}): ModelCatalogController {
  return new ModelCatalogController({
    ...options,
    adapters: {
      huggingface: new HuggingFaceModelCatalogAdapter({ fetch: fetchWithProxy }),
      modelscope: new ModelScopeModelCatalogAdapter({ fetch: fetchWithProxy }),
      ...options.adapters,
    },
    sink: options.sink || createNativeModelDownloadSink(),
  })
}
