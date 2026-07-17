export type ImageModelFamily = 'gemini' | 'openai'

const RATIO_OPTIONS: Record<ImageModelFamily | 'default', string[]> = {
  openai: ['auto', '1:1', '3:2', '2:3'],
  gemini: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9'],
  default: ['auto', '1:1', '3:2', '2:3'],
}

export function getImageModelFamily(modelId: string): ImageModelFamily | 'default' {
  if (modelId.includes('gemini') && modelId.includes('image')) return 'gemini'
  if (modelId.startsWith('gpt-image')) return 'openai'
  return 'default'
}

export function isGeminiImageModel(modelId: string): boolean {
  return getImageModelFamily(modelId) === 'gemini'
}

export function getRatioOptionsForModel(modelId: string): string[] {
  return RATIO_OPTIONS[getImageModelFamily(modelId)] ?? RATIO_OPTIONS.default
}
