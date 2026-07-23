import { describe, expect, it } from 'vitest'
import type { ModelArtifact } from './model-catalog'
import { resolveLocalRuntimeCapabilities } from './local-capabilities'

const artifact = (format: ModelArtifact['format']): ModelArtifact => ({
  id: format,
  modelId: 'model',
  source: 'huggingface',
  path: `model.${format}`,
  filename: `model.${format}`,
  url: 'https://example.com/model',
  downloadUrl: 'https://example.com/model',
  revision: 'abc',
  format,
  required: true,
  companion: false,
})

describe('resolveLocalRuntimeCapabilities', () => {
  it('enables explicit LiteRT-LM vision and audio input signals', () => {
    expect(
      resolveLocalRuntimeCapabilities(
        { capabilities: ['image-text-to-text', 'audio-text-to-text'], tags: ['multimodal'] },
        [artifact('litertlm')],
      ),
    ).toMatchObject({ text: true, vision: true, audioInput: true, speechOutput: false })
  })

  it('does not claim GGUF vision without the bundled mtmd runtime', () => {
    const result = resolveLocalRuntimeCapabilities({ capabilities: ['vision'], tags: [] }, [artifact('gguf')])
    expect(result.vision).toBe(false)
    expect(result.reasons).toContain('gguf_vision_requires_mtmd_runtime')
  })

  it('does not treat advertised TTS as an available decoder', () => {
    const result = resolveLocalRuntimeCapabilities({ capabilities: ['text-to-speech'], tags: [] }, [artifact('litertlm')])
    expect(result.speechOutput).toBe(false)
    expect(result.reasons).toContain('local_speech_decoder_not_bundled')
  })
})
