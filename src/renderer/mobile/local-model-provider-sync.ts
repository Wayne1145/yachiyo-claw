import type { DownloadJob } from '@shared/models/model-catalog'
import { providerCapabilitiesForLocalRuntime, resolveLocalRuntimeCapabilities } from '@shared/models/local-capabilities'
import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import { listNativeModelJobs } from '@/platform/native/yachiyo_model_manager'
import { persistSettingsPatch, settingsStore } from '@/stores/settingsStore'

function modelForJob(job: DownloadJob): ProviderModelInfo {
  const runtimeCapabilities =
    job.runtimeCapabilities ||
    resolveLocalRuntimeCapabilities(
      { capabilities: [], tags: [job.repository, job.modelId] },
      job.artifacts,
    )
  return {
    modelId: job.modelId,
    nickname: job.repository.split('/').at(-1) || job.repository,
    type: job.artifacts.some((artifact) => artifact.format === 'tflite') ? 'embedding' : 'chat',
    capabilities: providerCapabilitiesForLocalRuntime(runtimeCapabilities),
  }
}

/** Migrates previously downloaded models into the provider registry without changing user aliases. */
export function reconcileInstalledLocalModels(
  current: ProviderModelInfo[],
  jobs: DownloadJob[],
): ProviderModelInfo[] {
  const completedByModelId = new Map<string, DownloadJob>()
  for (const job of jobs) {
    // Native jobs are newest-first. Keep one provider entry even when an older
    // app version downloaded several quantizations under the same model ID.
    if (job.status === 'completed' && !completedByModelId.has(job.modelId)) {
      completedByModelId.set(job.modelId, job)
    }
  }
  const completed = [...completedByModelId.values()]
  const seenCurrent = new Set<string>()
  const reconciled = current
    .filter((model) => {
      if (!completedByModelId.has(model.modelId) || seenCurrent.has(model.modelId)) return false
      seenCurrent.add(model.modelId)
      return true
    })
    .map((model) => {
      const job = completedByModelId.get(model.modelId)
      if (!job) return model
      const inferred = modelForJob(job)
      return JSON.stringify(model.capabilities || []) === JSON.stringify(inferred.capabilities)
        ? model
        : { ...model, capabilities: inferred.capabilities }
    })
  const additions = completed
    .filter((job) => !current.some((model) => model.modelId === job.modelId))
    .map(modelForJob)
  return [...reconciled, ...additions]
}

/** Runs at Android shell startup so old downloads are usable before opening the model center. */
export async function syncInstalledLocalModelsIntoSettings(nativeJobs?: DownloadJob[]): Promise<boolean> {
  const jobs = nativeJobs || (await listNativeModelJobs()).jobs
  const settings = settingsStore.getState()
  const providers = settings.providers || {}
  const localProvider = providers[ModelProviderEnum.Local] || {}
  const current = localProvider.models || []
  const next = reconcileInstalledLocalModels(current, jobs)
  const defaultRemoved =
    settings.defaultChatModel?.provider === ModelProviderEnum.Local &&
    !next.some((model) => model.modelId === settings.defaultChatModel?.model)
  const availableIds = new Set(next.map((model) => model.modelId))
  const referenceWasRemoved = (reference?: { provider: string; model: string }) =>
    reference?.provider === ModelProviderEnum.Local && !availableIds.has(reference.model)
  const nextFavorites = settings.favoritedModels?.filter(
    (favorite) => favorite.provider !== ModelProviderEnum.Local || availableIds.has(favorite.model),
  )
  const favoritesChanged = JSON.stringify(nextFavorites) !== JSON.stringify(settings.favoritedModels)
  const threadNamingRemoved = referenceWasRemoved(settings.threadNamingModel)
  const searchModelRemoved = referenceWasRemoved(settings.searchTermConstructionModel)
  const ocrModelRemoved = referenceWasRemoved(settings.ocrModel)
  if (
    JSON.stringify(next) === JSON.stringify(current) &&
    !defaultRemoved &&
    !favoritesChanged &&
    !threadNamingRemoved &&
    !searchModelRemoved &&
    !ocrModelRemoved
  ) {
    return false
  }
  await persistSettingsPatch({
    providers: {
      ...providers,
      [ModelProviderEnum.Local]: { ...localProvider, models: next },
    },
    ...(defaultRemoved ? { defaultChatModel: undefined } : {}),
    ...(favoritesChanged ? { favoritedModels: nextFavorites } : {}),
    ...(threadNamingRemoved ? { threadNamingModel: undefined } : {}),
    ...(searchModelRemoved ? { searchTermConstructionModel: undefined } : {}),
    ...(ocrModelRemoved ? { ocrModel: undefined } : {}),
  })
  return true
}
