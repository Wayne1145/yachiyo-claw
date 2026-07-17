import type { TranslationCacheEntry, TranslationOptions, TranslationProvider } from './types'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'
const MS_AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const MS_TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate'
const TRANSLATION_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

// Microsoft is the default provider (reliable from both mainland China and
// overseas networks). Google is kept as an opt-in fallback for the case where
// Microsoft is unreachable. Fail fast on Google so users who explicitly opt
// into it don't hang on blocked networks.
const GOOGLE_FETCH_TIMEOUT_MS = 5000
const MS_FETCH_TIMEOUT_MS = 8000

// When Google is used (either as fallback or via explicit opt-in), stop
// probing it mid-batch after this many consecutive failures so the remaining
// texts can be served by Microsoft in a single batched request instead of
// stacking per-item timeouts.
const GOOGLE_FAILURE_THRESHOLD = 2

/**
 * Maps app language codes to Google Translate language codes
 */
export function mapLanguageCode(appLang: string): string {
  const mapping: Record<string, string> = {
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
    'nb-NO': 'no',
    'pt-PT': 'pt',
    'it-IT': 'it',
  }
  return mapping[appLang] || appLang
}

/**
 * Maps app language codes to Microsoft Translator language codes.
 * Microsoft uses `zh-Hans` / `zh-Hant` natively, unlike Google.
 */
function mapMicrosoftLanguageCode(appLang: string): string {
  const mapping: Record<string, string> = {
    'nb-NO': 'nb',
    'pt-PT': 'pt',
    'it-IT': 'it',
  }
  return mapping[appLang] || appLang
}

/**
 * Simple hash function for cache keys
 */
function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

/**
 * Translation cache with in-memory and localStorage persistence
 */
export class TranslationCache {
  private memoryCache: Map<string, TranslationCacheEntry> = new Map()
  private storageKey = 'translation-cache'

  constructor() {
    this.loadFromStorage()
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        const entries = JSON.parse(stored) as TranslationCacheEntry[]
        const now = Date.now()
        for (const entry of entries) {
          // Only load non-expired entries
          if (now - entry.timestamp < CACHE_TTL_MS) {
            const key = `${hashText(entry.originalText)}:${entry.targetLang}`
            this.memoryCache.set(key, entry)
          }
        }
      }
    } catch {
      // Silently fail on storage errors
    }
  }

  private saveToStorage(): void {
    try {
      const entries = Array.from(this.memoryCache.values())
      localStorage.setItem(this.storageKey, JSON.stringify(entries))
    } catch {
      // Silently fail on storage errors
    }
  }

  get(text: string, targetLang: string): string | null {
    const key = `${hashText(text)}:${targetLang}`
    const entry = this.memoryCache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now - entry.timestamp >= CACHE_TTL_MS) {
      this.memoryCache.delete(key)
      this.saveToStorage()
      return null
    }

    return entry.translatedText
  }

  set(text: string, translatedText: string, targetLang: string): void {
    const key = `${hashText(text)}:${targetLang}`
    const entry: TranslationCacheEntry = {
      originalText: text,
      translatedText,
      targetLang,
      timestamp: Date.now(),
    }
    this.memoryCache.set(key, entry)
    this.saveToStorage()
  }

  clear(): void {
    this.memoryCache.clear()
    this.saveToStorage()
  }
}

const cache = new TranslationCache()

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isInvalidTranslatedText(translated: string): boolean {
  const normalized = translated.trim()
  if (!normalized) {
    return true
  }

  // Guard against placeholder error messages that legacy fallback providers
  // (e.g. MyMemory) returned when the request was malformed.
  const upper = normalized.toUpperCase()
  if (upper.includes('NO QUERY SPECIFIED') || upper.includes('EXAMPLE REQUEST')) {
    return true
  }

  return false
}

/**
 * Translate a single text using Google Translate free endpoint
 */
async function translateOneWithGoogle(
  text: string,
  targetLang: string,
  sourceLang: string
): Promise<string | null> {
  try {
    const mappedLang = mapLanguageCode(targetLang)
    const params = new URLSearchParams({
      client: 'gtx',
      sl: sourceLang,
      tl: mappedLang,
      dt: 't',
      q: text,
    })

    const url = `${GOOGLE_TRANSLATE_URL}?${params.toString()}`

    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': TRANSLATION_USER_AGENT,
        },
      },
      GOOGLE_FETCH_TIMEOUT_MS
    )

    if (!response.ok) return null

    const data = (await response.json()) as unknown[]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translations = (data[0] as unknown[])
        .map((item) => {
          if (Array.isArray(item) && typeof item[0] === 'string') {
            return item[0]
          }
          return ''
        })
        .filter((t) => t.length > 0)
      const joined = translations.join('')
      if (joined) return joined
    }

    return null
  } catch {
    return null
  }
}

async function translateWithGoogle(
  texts: string[],
  targetLang: string,
  sourceLang: string
): Promise<(string | null)[]> {
  // Google's free endpoint is per-text; loop sequentially. Short-circuit
  // after GOOGLE_FAILURE_THRESHOLD consecutive failures so a 30-item batch
  // against a blocked Google doesn't stack 30 × 5s of timeouts before the
  // caller can hand the rest off to Microsoft.
  const results: (string | null)[] = []
  let failuresInThisBatch = 0
  for (let i = 0; i < texts.length; i++) {
    if (failuresInThisBatch >= GOOGLE_FAILURE_THRESHOLD) {
      for (let j = i; j < texts.length; j++) {
        results.push(null)
      }
      break
    }

    const translated = await translateOneWithGoogle(texts[i], targetLang, sourceLang)
    results.push(translated)
    if (translated === null) {
      failuresInThisBatch++
    } else {
      failuresInThisBatch = 0
    }
  }
  return results
}

/**
 * Microsoft Edge Translator auth token.
 *
 * Inspired by https://github.com/fishjar/kiss-translator — the Edge browser
 * exposes a public JWT endpoint that returns an anonymous token usable against
 * the cognitive services translate endpoint. The token is a standard JWT whose
 * `exp` claim gives the expiration (~10 minutes typical).
 */
interface MicrosoftAuth {
  token: string
  expiresAt: number // epoch ms
}

let cachedMicrosoftAuth: MicrosoftAuth | null = null
let microsoftAuthInFlight: Promise<MicrosoftAuth | null> | null = null

function parseMicrosoftTokenExp(token: string): number {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return 0
    // base64url → base64
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = atob(padded)
    const payload = JSON.parse(decoded) as { exp?: number }
    return (payload.exp ?? 0) * 1000
  } catch {
    return 0
  }
}

async function fetchMicrosoftAuth(): Promise<MicrosoftAuth | null> {
  try {
    const response = await fetchWithTimeout(
      MS_AUTH_URL,
      {
        method: 'GET',
        headers: {
          'User-Agent': TRANSLATION_USER_AGENT,
        },
      },
      MS_FETCH_TIMEOUT_MS
    )

    if (!response.ok) return null

    const token = (await response.text()).trim()
    if (!token) return null

    const expiresAt = parseMicrosoftTokenExp(token)
    if (!expiresAt) return null

    return {
      token,
      // Expire a minute early to avoid races at the boundary.
      expiresAt: expiresAt - 60_000,
    }
  } catch {
    return null
  }
}

async function getMicrosoftAuth(): Promise<MicrosoftAuth | null> {
  if (cachedMicrosoftAuth && cachedMicrosoftAuth.expiresAt > Date.now()) {
    return cachedMicrosoftAuth
  }
  if (!microsoftAuthInFlight) {
    microsoftAuthInFlight = fetchMicrosoftAuth().then((auth) => {
      cachedMicrosoftAuth = auth
      microsoftAuthInFlight = null
      return auth
    })
  }
  return microsoftAuthInFlight
}

function invalidateMicrosoftAuth(): void {
  cachedMicrosoftAuth = null
}

interface MicrosoftTranslateResponseItem {
  translations?: Array<{ text?: string; to?: string }>
  detectedLanguage?: { language?: string; score?: number }
}

/**
 * Translate an array of texts using Microsoft Edge Translator.
 *
 * Supports true batch translation — all texts are sent in a single request.
 * Returns an array parallel to `texts`; failed entries are `null`.
 */
async function translateWithMicrosoft(
  texts: string[],
  targetLang: string,
  sourceLang: string
): Promise<(string | null)[]> {
  if (texts.length === 0) return []

  try {
    const auth = await getMicrosoftAuth()
    if (!auth) return texts.map(() => null)

    const toLang = mapMicrosoftLanguageCode(targetLang)
    const params = new URLSearchParams({
      'api-version': '3.0',
      to: toLang,
    })
    // Omit `from` entirely to let Microsoft auto-detect, matching its API.
    if (sourceLang && sourceLang !== 'auto') {
      params.set('from', mapMicrosoftLanguageCode(sourceLang))
    }

    const url = `${MS_TRANSLATE_URL}?${params.toString()}`
    const body = JSON.stringify(texts.map((text) => ({ Text: text })))

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
          'User-Agent': TRANSLATION_USER_AGENT,
        },
        body,
      },
      MS_FETCH_TIMEOUT_MS
    )

    if (!response.ok) {
      // Token may be rejected on 401; clear so the next call re-fetches.
      if (response.status === 401 || response.status === 403) {
        invalidateMicrosoftAuth()
      }
      return texts.map(() => null)
    }

    const data = (await response.json()) as MicrosoftTranslateResponseItem[] | { error?: unknown }

    if (!Array.isArray(data)) {
      // Error envelopes from the API look like { error: { code, message } }.
      invalidateMicrosoftAuth()
      return texts.map(() => null)
    }

    return texts.map((_, i) => {
      const translated = data[i]?.translations?.[0]?.text
      if (!translated || isInvalidTranslatedText(translated)) {
        return null
      }
      return translated
    })
  } catch {
    return texts.map(() => null)
  }
}

/**
 * Translate an array of texts to target language.
 *
 * Microsoft Edge Translator is the default primary provider because it is
 * reachable from both mainland China and overseas networks, and it supports
 * true batch translation (one HTTP request per call regardless of batch size).
 * Google Translate is kept as a fallback for the rare case Microsoft fails.
 * Callers can opt into Google as the primary via `options.provider`. Returns
 * original texts if both services fail.
 */
export async function translateTexts(
  texts: string[],
  targetLang: string,
  options: TranslationOptions = {}
): Promise<string[]> {
  const { sourceLang = 'auto', provider } = options

  if (texts.length === 0) return []

  // Resolve each text against the cache first. Collect the ones we still need
  // to translate so the provider can handle them as a single batch.
  const results: string[] = new Array(texts.length)
  const pendingIndices: number[] = []
  const pendingTexts: string[] = []

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    const cached = cache.get(text, targetLang)
    if (cached !== null && !isInvalidTranslatedText(cached)) {
      results[i] = cached
    } else {
      pendingIndices.push(i)
      pendingTexts.push(text)
    }
  }

  if (pendingTexts.length === 0) {
    return results
  }

  const effectiveProvider: TranslationProvider = provider ?? 'microsoft'

  const primary = effectiveProvider === 'google' ? translateWithGoogle : translateWithMicrosoft
  const secondary = effectiveProvider === 'google' ? translateWithMicrosoft : translateWithGoogle

  const translated = await primary(pendingTexts, targetLang, sourceLang)

  // Determine which entries still need a fallback attempt.
  const needFallback: number[] = []
  const fallbackTexts: string[] = []
  for (let i = 0; i < translated.length; i++) {
    if (translated[i] === null) {
      needFallback.push(i)
      fallbackTexts.push(pendingTexts[i])
    }
  }

  if (needFallback.length > 0) {
    const fallbackResults = await secondary(fallbackTexts, targetLang, sourceLang)
    for (let j = 0; j < needFallback.length; j++) {
      if (fallbackResults[j] !== null) {
        translated[needFallback[j]] = fallbackResults[j]
      }
    }
  }

  // Merge translated entries back into results, falling back to original text
  // when both providers failed.
  for (let i = 0; i < pendingIndices.length; i++) {
    const idx = pendingIndices[i]
    const original = pendingTexts[i]
    const value = translated[i]
    if (value) {
      results[idx] = value
      cache.set(original, value, targetLang)
    } else {
      results[idx] = original
    }
  }

  return results
}

// Exposed for tests so each case can start from a clean session state.
export function __resetTranslationSessionState(): void {
  cachedMicrosoftAuth = null
  microsoftAuthInFlight = null
  // Also wipe the module-level translation cache so test case ordering can't
  // produce false passes via cross-test cache hits.
  cache.clear()
}
