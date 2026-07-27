import { describe, expect, it } from 'vitest'
import type { DownloadJob } from '@shared/models/model-catalog'
import { reconcileInstalledLocalModels } from './local-model-provider-sync'

function functionGemmaJob(): DownloadJob {
  return {
    id: 'job-1',
    modelId: 'qa-functiongemma-270m-v011',
    source: 'huggingface',
    repository: 'google/functiongemma-270m-it',
    revision: 'a'.repeat(40),
    status: 'completed',
    artifactIds: ['model'],
    artifacts: [
      {
        id: 'model',
        modelId: 'qa-functiongemma-270m-v011',
        source: 'huggingface',
        path: 'mobile-actions_q8_ekv1024.litertlm',
        filename: 'mobile-actions_q8_ekv1024.litertlm',
        url: 'https://example.test/model',
        downloadUrl: 'https://example.test/model',
        revision: 'a'.repeat(40),
        format: 'litertlm',
        required: true,
        companion: false,
      },
    ],
    bytesTotal: 1,
    bytesDownloaded: 1,
    maxConcurrentSegments: 1,
    segments: [],
    allowUnpinnedRevision: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function duplicateFunctionGemmaJob(): DownloadJob {
  return { ...functionGemmaJob(), id: 'job-2', updatedAt: 2 }
}

describe('installed local model provider reconciliation', () => {
  it('adds tool-use capability to migrated FunctionGemma records', () => {
    const result = reconcileInstalledLocalModels(
      [{ modelId: 'qa-functiongemma-270m-v011', type: 'chat', capabilities: [] }],
      [functionGemmaJob()],
    )
    expect(result).toHaveLength(1)
    expect(result[0].capabilities).toContain('tool_use')
  })

  it('adds a completed model only once', () => {
    const once = reconcileInstalledLocalModels([], [functionGemmaJob()])
    const twice = reconcileInstalledLocalModels(once, [functionGemmaJob()])
    expect(twice).toEqual(once)
  })

  it('removes provider entries whose native model is no longer completed', () => {
    const result = reconcileInstalledLocalModels(
      [{ modelId: 'deleted-model', type: 'chat' }, { modelId: 'qa-functiongemma-270m-v011', type: 'chat' }],
      [functionGemmaJob()],
    )

    expect(result.map((model) => model.modelId)).toEqual(['qa-functiongemma-270m-v011'])
  })

  it('collapses duplicate native jobs and stale duplicate provider entries', () => {
    const duplicate = { modelId: 'qa-functiongemma-270m-v011', type: 'chat' as const }
    const result = reconcileInstalledLocalModels(
      [duplicate, { ...duplicate, nickname: 'stale duplicate' }],
      [duplicateFunctionGemmaJob(), functionGemmaJob()],
    )

    expect(result).toHaveLength(1)
    expect(result[0].modelId).toBe('qa-functiongemma-270m-v011')
  })
})
