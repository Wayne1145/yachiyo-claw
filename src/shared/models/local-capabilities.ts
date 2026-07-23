import { z } from 'zod'
import type { ModelArtifact, RemoteModel } from './model-catalog'

export const LocalRuntimeCapabilitiesSchema = z.object({
  text: z.boolean(),
  vision: z.boolean(),
  audioInput: z.boolean(),
  speechOutput: z.boolean(),
  reasoning: z.boolean(),
  toolUse: z.boolean(),
  streaming: z.boolean(),
  reasons: z.array(z.string()).max(16),
})

export type LocalRuntimeCapabilities = z.infer<typeof LocalRuntimeCapabilitiesSchema>

function hasSignal(signals: string[], values: string[]): boolean {
  return signals.some((signal) => values.some((value) => signal === value || signal.includes(value)))
}

/** Declares only capabilities supported by both the selected artifacts and the bundled Android runtime. */
export function resolveLocalRuntimeCapabilities(
  model: Pick<RemoteModel, 'capabilities' | 'tags'>,
  artifacts: ModelArtifact[],
): LocalRuntimeCapabilities {
  const formats = new Set(artifacts.map((artifact) => artifact.format))
  const signals = [...(model.capabilities || []), ...(model.tags || [])].map((value) => value.trim().toLowerCase())
  const isLiteRtLm = formats.has('litertlm')
  const isChatModel = isLiteRtLm || formats.has('gguf')
  const advertisedVision = hasSignal(signals, [
    'vision',
    'multimodal',
    'image-to-text',
    'image-text-to-text',
    'visual-question-answering',
  ])
  const advertisedAudioInput = hasSignal(signals, [
    'audio-input',
    'audio_input',
    'audio-text-to-text',
    'speech-to-text',
    'automatic-speech-recognition',
  ])
  const advertisedSpeechOutput = hasSignal(signals, ['text-to-speech', 'speech-output', 'speech_output', 'tts'])
  const reasons: string[] = []
  if (formats.has('gguf') && advertisedVision) reasons.push('gguf_vision_requires_mtmd_runtime')
  if (advertisedSpeechOutput) reasons.push('local_speech_decoder_not_bundled')

  return {
    text: isChatModel,
    vision: isLiteRtLm && advertisedVision,
    audioInput: isLiteRtLm && advertisedAudioInput,
    speechOutput: false,
    reasoning: hasSignal(signals, ['reasoning', 'thinking']),
    toolUse: false,
    streaming: false,
    reasons,
  }
}

export function providerCapabilitiesForLocalRuntime(
  capabilities?: LocalRuntimeCapabilities,
): Array<'vision' | 'reasoning' | 'tool_use' | 'web_search' | 'audio_input' | 'tts'> {
  if (!capabilities) return []
  return [
    ...(capabilities.vision ? (['vision'] as const) : []),
    ...(capabilities.reasoning ? (['reasoning'] as const) : []),
    ...(capabilities.audioInput ? (['audio_input'] as const) : []),
    ...(capabilities.speechOutput ? (['tts'] as const) : []),
  ]
}
