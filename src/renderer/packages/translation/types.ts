export interface TranslationCacheEntry {
  originalText: string
  translatedText: string
  targetLang: string
  timestamp: number
}

export type TranslationProvider = 'google' | 'microsoft'

export interface TranslationOptions {
  sourceLang?: string
  provider?: TranslationProvider
}
