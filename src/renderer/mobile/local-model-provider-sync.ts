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
  const completed = jobs.filter((job) => job.status === 'completed')
  const completedByModelId = new Map(completed.map((job) => [job.modelId, job]))
  const reconciled = current.map((model) => {
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
export async function syncInstalledLocalModelsIntoSettings(): Promise<boolean> {
  const { jobs } = await listNativeModelJobs()
  const settings = settingsStore.getState()
  const providers = settings.providers || {}
  const localProvider = providers[ModelProviderEnum.Local] || {}
  const current = localProvider.models || []
  const next = reconcileInstalledLocalModels(current, jobs)
  if (JSON.stringify(next) === JSON.stringify(current)) return false
  await persistSettingsPatch({
    providers: {
      ...providers,
      [ModelProviderEnum.Local]: { ...localProvider, models: next },
    },
  })
  return true
}
