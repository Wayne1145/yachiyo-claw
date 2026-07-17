import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
})()
vi.stubGlobal('localStorage', mockLocalStorage)

import {
  __resetTranslationSessionState,
  mapLanguageCode,
  TranslationCache,
  translateTexts,
} from '@/packages/translation/service'

function makeGoogleResponse(translatedText: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve([[[translatedText, 'original', null, null, null, null, null, []]]]),
  }
}

/**
 * Build a fake Microsoft Edge translator JWT. The client only cares about the
 * `exp` claim in the middle segment; the signature is not verified.
 */
function makeMsJwt(expSecondsFromNow = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })
  ).toString('base64url')
  return `${header}.${payload}.signature`
}

function makeMsAuthResponse() {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(makeMsJwt()),
  }
}

function makeMsTranslateResponse(translatedTexts: string[]) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve(
        translatedTexts.map((text) => ({
          detectedLanguage: { language: 'en', score: 1 },
          translations: [{ text, to: 'xx' }],
        }))
      ),
  }
}

function makeFailedResponse(status = 500) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  }
}

describe('translation service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockLocalStorage.clear()
    __resetTranslationSessionState()
  })

  describe('mapLanguageCode', () => {
    it('should map known language codes correctly', () => {
      expect(mapLanguageCode('zh-Hans')).toBe('zh-CN')
      expect(mapLanguageCode('zh-Hant')).toBe('zh-TW')
      expect(mapLanguageCode('nb-NO')).toBe('no')
      expect(mapLanguageCode('pt-PT')).toBe('pt')
      expect(mapLanguageCode('it-IT')).toBe('it')
    })

    it('should return unmapped codes as-is', () => {
      expect(mapLanguageCode('en')).toBe('en')
      expect(mapLanguageCode('fr')).toBe('fr')
      expect(mapLanguageCode('de')).toBe('de')
    })
  })

  describe('TranslationCache', () => {
    it('should return cached translation on hit', () => {
      const cache = new TranslationCache()
      cache.set('hello', 'hola', 'es')

      expect(cache.get('hello', 'es')).toBe('hola')
    })

    it('should return null on cache miss', () => {
      const cache = new TranslationCache()

      expect(cache.get('nonexistent', 'fr')).toBeNull()
    })

    it('should persist to localStorage', () => {
      const cache = new TranslationCache()
      cache.set('hello', 'bonjour', 'fr')

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('translation-cache', expect.stringContaining('bonjour'))
    })
  })

  describe('translateTexts', () => {
    it('should translate using Microsoft Edge by default', async () => {
      // Default path: MS auth → MS translate. No Google request should fire.
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['你好世界']))

      const result = await translateTexts(['Good morning sunshine'], 'zh-Hans')

      expect(result).toEqual(['你好世界'])
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://edge.microsoft.com/translate/auth',
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('api-edge.cognitive.microsofttranslator.com/translate'),
        expect.objectContaining({ method: 'POST' })
      )
      const googleCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('translate.googleapis.com')
      )
      expect(googleCalls).toHaveLength(0)
    })

    it('should batch multiple texts in a single Microsoft request', async () => {
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['你好', '世界']))

      const result = await translateTexts(['hello', 'world'], 'zh-Hans')

      expect(result).toEqual(['你好', '世界'])
      const msCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('microsofttranslator.com')
      )
      expect(msCall).toBeDefined()
      const init = msCall?.[1] as RequestInit | undefined
      expect(init?.body).toBe(JSON.stringify([{ Text: 'hello' }, { Text: 'world' }]))
    })

    it('should fall back to Google when Microsoft auth fails', async () => {
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // MS auth fails
      mockFetch.mockResolvedValueOnce(makeGoogleResponse('Hallo Welt'))

      const result = await translateTexts(['Fallback to google'], 'de')

      expect(result).toEqual(['Hallo Welt'])
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('translate.googleapis.com'),
        expect.any(Object)
      )
    })

    it('should fall back to Google when Microsoft translate fails', async () => {
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // MS translate fails
      mockFetch.mockResolvedValueOnce(makeGoogleResponse('Bonjour le monde'))

      const result = await translateTexts(['Hello world secondary'], 'fr')

      expect(result).toEqual(['Bonjour le monde'])
      const googleCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('translate.googleapis.com')
      )
      expect(googleCall).toBeDefined()
    })

    it('should only fall back to Google for texts Microsoft could not translate', async () => {
      // MS batch returns null for text 1 (empty translations array). Google
      // should be invoked only for that one entry. Index alignment regression.
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            { translations: [{ text: 'primary 0' }] },
            { translations: [] }, // failure
            { translations: [{ text: 'primary 2' }] },
          ]),
      })
      mockFetch.mockResolvedValueOnce(makeGoogleResponse('fallback 1'))

      const result = await translateTexts(['text zero', 'text one', 'text two'], 'de')

      expect(result).toEqual(['primary 0', 'fallback 1', 'primary 2'])

      // Google should have been invoked exactly once, for text one.
      const googleCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('translate.googleapis.com')
      )
      expect(googleCalls).toHaveLength(1)
      const googleUrl = googleCalls[0][0] as string
      expect(googleUrl).toContain('q=text+one')
    })

    it('should reuse a cached Microsoft auth token across calls', async () => {
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['一']))
      await translateTexts(['alpha'], 'zh-Hans')

      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['二']))
      await translateTexts(['beta'], 'zh-Hans')

      const authCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('edge.microsoft.com/translate/auth')
      )
      expect(authCalls).toHaveLength(1)
    })

    it('should return original text when both services fail', async () => {
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // ms auth
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // google

      const result = await translateTexts(['Both fail unique text'], 'ja')

      expect(result).toEqual(['Both fail unique text'])
    })

    it('should honor explicit google-first opt-in via options.provider', async () => {
      mockFetch.mockResolvedValueOnce(makeGoogleResponse('Hola mundo'))

      const result = await translateTexts(['Explicit google'], 'es', { provider: 'google' })

      expect(result).toEqual(['Hola mundo'])
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('translate.googleapis.com'),
        expect.any(Object)
      )
    })

    it('should stop probing Google mid-batch when explicit google opt-in hits failures', async () => {
      // Explicit provider: google. Every Google request fails. Short-circuit
      // must cap Google requests at the failure threshold (2) and let MS
      // batch-translate the remaining 8 texts in one request.
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // google 1
      mockFetch.mockResolvedValueOnce(makeFailedResponse()) // google 2 — trips
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(
        makeMsTranslateResponse(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
      )

      const inputs = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']
      const result = await translateTexts(inputs, 'zh-Hans', { provider: 'google' })

      expect(result).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])

      const googleCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('translate.googleapis.com')
      )
      expect(googleCalls).toHaveLength(2)

      const msCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('microsofttranslator.com')
      )
      const init = msCall?.[1] as RequestInit | undefined
      expect(init?.body).toBe(JSON.stringify(inputs.map((t) => ({ Text: t }))))
    })

    it('should use cache and skip fetch on second call with same text', async () => {
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['Bonjour cache test']))

      await translateTexts(['Cache test input'], 'fr')
      mockFetch.mockReset()

      const result = await translateTexts(['Cache test input'], 'fr')

      expect(result).toEqual(['Bonjour cache test'])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should apply Google language code mapping when Google is invoked', async () => {
      mockFetch.mockResolvedValueOnce(makeGoogleResponse('你好映射'))

      await translateTexts(['Language mapping test'], 'zh-Hans', { provider: 'google' })

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('tl=zh-CN'), expect.any(Object))
    })

    it('should send zh-Hans (not zh-CN) to the Microsoft endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeMsAuthResponse())
      mockFetch.mockResolvedValueOnce(makeMsTranslateResponse(['你好']))

      await translateTexts(['MS language mapping'], 'zh-Hans')

      const msTranslateCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('microsofttranslator.com')
      )
      expect(msTranslateCall?.[0]).toContain('to=zh-Hans')
    })
  })
})
