import type { ModelArtifact, RemoteModel } from '@shared/models/model-catalog'
import { describe, expect, it } from 'vitest'
import {
  buildSelectedLocalModel,
  listRunnableLocalModelArtifacts,
  localModelRuntimeForArtifact,
  resolveLocalModelArtifactGroup,
} from './local-model-artifacts'

function artifact(filename: string, sizeBytes = 1024): ModelArtifact {
  return {
    id: filename,
    modelId: 'model',
    source: 'huggingface',
    path: filename,
    filename,
    url: `https://example.test/${filename}`,
    downloadUrl: `https://example.test/${filename}`,
    revision: 'a'.repeat(40),
    sha256: 'b'.repeat(64),
    sizeBytes,
    format: filename.endsWith('.gguf') ? 'gguf' : 'litertlm',
    runtime: filename.endsWith('.gguf') ? 'llama.cpp' : 'litert-lm',
    required: true,
    companion: false,
  }
}

describe('local model artifact selection', () => {
  it('offers primary GGUF weights while excluding mmproj and later shards', () => {
    const result = listRunnableLocalModelArtifacts(
      [
        artifact('model-Q8_0.gguf', 5000),
        artifact('model-Q4_K_M.gguf', 3000),
        artifact('mmproj-model-f16.gguf', 200),
        artifact('split-Q4_K_M-00001-of-00002.gguf', 2000),
        artifact('split-Q4_K_M-00002-of-00002.gguf', 2000),
      ],
      10_000,
    )

    expect(result.map((item) => item.filename)).toEqual([
      'split-Q4_K_M-00001-of-00002.gguf',
      'model-Q4_K_M.gguf',
      'model-Q8_0.gguf',
    ])
  })

  it('resolves a complete GGUF shard group and rejects incomplete groups', () => {
    const first = artifact('gemma-Q4_K_M-00001-of-00002.gguf', 2000)
    const second = artifact('gemma-Q4_K_M-00002-of-00002.gguf', 2000)
    expect(resolveLocalModelArtifactGroup(first, [first, second], 5000)).toEqual([first, second])
    expect(resolveLocalModelArtifactGroup(first, [first], 5000)).toEqual([])
    expect(listRunnableLocalModelArtifacts([first], 5000)).toEqual([])
    expect(listRunnableLocalModelArtifacts([first, second], 3000)).toEqual([])
  })

  it('maps GGUF downloads to llama.cpp', () => {
    expect(localModelRuntimeForArtifact(artifact('model.gguf'))).toBe('llama.cpp')
  })

  it('assesses only the selected quantization or complete shard group', () => {
    const first = artifact('gemma-Q4_K_M-00001-of-00002.gguf', 2_000)
    const second = artifact('gemma-Q4_K_M-00002-of-00002.gguf', 3_000)
    const model = {
      id: 'model',
      modelId: 'model',
      name: 'model',
      displayName: 'Model',
      source: 'huggingface',
      repository: 'owner/model',
      revision: 'a'.repeat(40),
      revisionPinned: true,
      gated: false,
      artifacts: [first, second, artifact('model-Q8_0.gguf', 20_000)],
      formats: ['gguf'],
      runtimeCandidates: ['llama.cpp'],
      architecture: [],
      tags: [],
      storageSizeBytes: 25_000,
    } as RemoteModel

    const selected = buildSelectedLocalModel(model, [first, second])
    expect(selected.artifacts.map((item) => item.id)).toEqual([first.id, second.id])
    expect(selected.storageSizeBytes).toBe(5_000)
    expect(selected.estimatedRamBytes).toBe(Math.ceil(5_000 * 1.35))
    expect(selected.requiredStorageBytes).toBe(Math.ceil(5_000 * 1.1))
  })
})
