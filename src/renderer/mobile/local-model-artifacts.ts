import type { ModelArtifact, RemoteModel } from '@shared/models/model-catalog'

const GGUF_SHARD_RE = /^(.*?)-(\d{5})-of-(\d{5})\.gguf$/i
const NON_PRIMARY_GGUF_RE = /(?:^|[._-])(mmproj|projector|vision|draft|speculative)(?:[._-]|$)/i

export function isRunnableLocalModelArtifact(artifact: ModelArtifact, maxBytes: number): boolean {
  if (!artifact.sha256 || !artifact.sizeBytes || artifact.sizeBytes <= 0 || artifact.sizeBytes > maxBytes) return false
  if (artifact.format === 'litertlm' || artifact.format === 'tflite') return true
  if (artifact.format !== 'gguf') return false
  return !NON_PRIMARY_GGUF_RE.test(artifact.filename || artifact.path)
}

export function listRunnableLocalModelArtifacts(artifacts: ModelArtifact[], maxBytes: number): ModelArtifact[] {
  return artifacts
    .filter((artifact) => isRunnableLocalModelArtifact(artifact, maxBytes))
    .filter((artifact) => {
      const match = (artifact.filename || artifact.path).match(GGUF_SHARD_RE)
      return !match || match[2] === '00001'
    })
    .filter((artifact) => resolveLocalModelArtifactGroup(artifact, artifacts, maxBytes).length > 0)
    .sort((left, right) => {
      const leftPreferred = /q4[_-]?k[_-]?m/i.test(left.filename || left.path) ? 0 : 1
      const rightPreferred = /q4[_-]?k[_-]?m/i.test(right.filename || right.path) ? 0 : 1
      return leftPreferred - rightPreferred || (left.sizeBytes || Infinity) - (right.sizeBytes || Infinity)
    })
}

export function resolveLocalModelArtifactGroup(
  selected: ModelArtifact,
  allArtifacts: ModelArtifact[],
  maxTotalBytes: number,
): ModelArtifact[] {
  if (selected.format !== 'gguf') return [selected]
  const selectedName = selected.filename || selected.path
  const match = selectedName.match(GGUF_SHARD_RE)
  if (!match) return [selected]

  const expectedCount = Number(match[3])
  const group = allArtifacts
    .filter((artifact) => {
      if (artifact.format !== 'gguf' || !artifact.sha256 || !artifact.sizeBytes) return false
      const candidate = (artifact.filename || artifact.path).match(GGUF_SHARD_RE)
      return Boolean(candidate && candidate[1] === match[1] && candidate[3] === match[3])
    })
    .sort((left, right) => (left.filename || left.path).localeCompare(right.filename || right.path))

  const total = group.reduce((sum, artifact) => sum + (artifact.sizeBytes || 0), 0)
  if (group.length !== expectedCount || total > maxTotalBytes) return []
  return group
}

export function localModelRuntimeForArtifact(artifact: ModelArtifact) {
  if (artifact.format === 'gguf') return 'llama.cpp' as const
  if (artifact.format === 'tflite') return 'mediapipe-text' as const
  return 'litert-lm' as const
}

export function buildSelectedLocalModel(model: RemoteModel, artifacts: ModelArtifact[]): RemoteModel {
  if (artifacts.length === 0) return model
  const storageSizeBytes = artifacts.reduce((total, artifact) => total + (artifact.sizeBytes || 0), 0)
  const formats = [...new Set(artifacts.map((artifact) => artifact.format))]
  const runtimeCandidates = [
    ...new Set(
      artifacts
        .map((artifact) => artifact.runtime || localModelRuntimeForArtifact(artifact))
        .filter(Boolean),
    ),
  ]
  const ramMultiplier = artifacts.some((artifact) => artifact.format === 'gguf') ? 1.35 : 1.25
  return {
    ...model,
    artifacts: artifacts.map((artifact) => ({ ...artifact, required: true })),
    formats,
    runtimeCandidates,
    storageSizeBytes,
    estimatedRamBytes: storageSizeBytes > 0 ? Math.ceil(storageSizeBytes * ramMultiplier) : undefined,
    requiredStorageBytes: storageSizeBytes > 0 ? Math.ceil(storageSizeBytes * 1.1) : undefined,
  }
}
