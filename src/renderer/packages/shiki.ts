import type { BundledLanguage } from 'shiki'
import { createHighlighter } from 'shiki'

export type ShikiTheme = 'one-dark-pro' | 'one-light'

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>

let instance: Highlighter | null = null
let initPromise: Promise<Highlighter> | null = null

const PLAINTEXT_ALIASES = new Set(['text', 'plaintext', 'txt', 'plain'])

const CACHE_MAX_SIZE = 50
const htmlCache = new Map<string, string>()

function cacheKey(code: string, language: string, theme: string): string {
  return `${theme}\0${language}\0${code}`
}

function cacheGet(code: string, language: string, theme: string): string | undefined {
  const key = cacheKey(code, language, theme)
  const cached = htmlCache.get(key)
  if (cached !== undefined) {
    htmlCache.delete(key)
    htmlCache.set(key, cached)
  }
  return cached
}

function cacheSet(code: string, language: string, theme: string, html: string): void {
  const key = cacheKey(code, language, theme)
  htmlCache.delete(key)
  htmlCache.set(key, html)
  if (htmlCache.size > CACHE_MAX_SIZE) {
    const oldest = htmlCache.keys().next().value
    if (oldest !== undefined) htmlCache.delete(oldest)
  }
}

function init(): Promise<Highlighter> {
  if (!initPromise) {
    initPromise = createHighlighter({
      themes: ['one-dark-pro', 'one-light'],
      langs: [],
    }).then((h) => {
      instance = h
      return h
    })
  }
  return initPromise
}

void init()

const pendingLangs = new Map<string, Promise<void>>()

function resolveLangSync(h: Highlighter, lang: string): string | null {
  if (PLAINTEXT_ALIASES.has(lang)) return 'plaintext'
  if (h.getLoadedLanguages().includes(lang)) return lang
  return null
}

async function ensureLang(h: Highlighter, lang: string): Promise<string> {
  if (PLAINTEXT_ALIASES.has(lang)) return 'plaintext'
  if (h.getLoadedLanguages().includes(lang)) return lang

  if (!pendingLangs.has(lang)) {
    pendingLangs.set(
      lang,
      h
        .loadLanguage(lang as BundledLanguage)
        .then(() => {
          pendingLangs.delete(lang)
        })
        .catch(() => {
          pendingLangs.delete(lang)
        })
    )
  }
  await pendingLangs.get(lang)

  return h.getLoadedLanguages().includes(lang) ? lang : 'plaintext'
}

export async function highlight(code: string, language: string, theme: ShikiTheme): Promise<string> {
  const cached = cacheGet(code, language, theme)
  if (cached !== undefined) return cached

  const h = await init()
  const lang = await ensureLang(h, language)
  const html = h.codeToHtml(code, { lang, theme })
  cacheSet(code, language, theme, html)
  return html
}

export function highlightSync(code: string, language: string, theme: ShikiTheme): string | null {
  const cached = cacheGet(code, language, theme)
  if (cached !== undefined) return cached

  if (!instance) return null
  const lang = resolveLangSync(instance, language)
  if (!lang) return null
  try {
    const html = instance.codeToHtml(code, { lang, theme })
    cacheSet(code, language, theme, html)
    return html
  } catch {
    return null
  }
}
