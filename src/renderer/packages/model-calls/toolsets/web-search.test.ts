import { ChatboxAIAPIError } from '@shared/models/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getExtensionSettingsMock = vi.fn()
const getParseLinkProviderMock = vi.fn()
const webSearchExecutorMock = vi.fn()

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => getExtensionSettingsMock(),
}))

vi.mock('@/packages/web-search', () => ({
  getParseLinkProvider: () => getParseLinkProviderMock(),
  webSearchExecutor: (...args: unknown[]) => webSearchExecutorMock(...args),
}))

// Import after mocks are registered
import { parseLinkTool } from '@/packages/model-calls/toolsets/web-search'

type ParseLinkInput = { url: string; maxLength?: number }

type ParseLinkToolLike = {
  execute: (input: ParseLinkInput, context: { abortSignal?: AbortSignal }) => Promise<{
    url: string
    title: string
    content: string
    originalLength: number
    truncated: boolean
  }>
}

async function execParseLink(input: ParseLinkInput, abortSignal?: AbortSignal) {
  // The `tool()` wrapper from `ai` exposes `execute` directly on the returned object.
  return await (parseLinkTool as unknown as ParseLinkToolLike).execute(input, { abortSignal })
}

describe('parseLinkTool', () => {
  beforeEach(() => {
    getExtensionSettingsMock.mockReset()
    getParseLinkProviderMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('build-in (retired) provider', () => {
    beforeEach(() => {
      getExtensionSettingsMock.mockReturnValue({ webSearch: { provider: 'build-in' } })
    })

    it('throws parse_link_not_supported now that the Chatbox cloud backend is retired', async () => {
      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'parse_link_not_supported' },
      })
      expect(getParseLinkProviderMock).not.toHaveBeenCalled()
    })
  })

  describe('third-party provider (e.g. Tavily)', () => {
    beforeEach(() => {
      getExtensionSettingsMock.mockReturnValue({ webSearch: { provider: 'tavily' } })
    })

    it('truncates content to maxLength', async () => {
      const longContent = 'a'.repeat(20_000)
      getParseLinkProviderMock.mockReturnValue({
        parseLink: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 't', content: longContent }),
      })

      const result = await execParseLink({ url: 'https://example.com', maxLength: 500 })

      expect(result.content.length).toBe(500)
      expect(result.originalLength).toBe(20_000)
      expect(result.truncated).toBe(true)
    })

    it('clamps maxLength below minimum (500) and above maximum (50000)', async () => {
      const longContent = 'a'.repeat(60_000)
      getParseLinkProviderMock.mockReturnValue({
        parseLink: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 't', content: longContent }),
      })

      // Below min: 100 should clamp to 500
      const tooSmall = await execParseLink({ url: 'https://example.com', maxLength: 100 })
      expect(tooSmall.content.length).toBe(500)

      // Above max: 999_999 should clamp to 50_000
      const tooBig = await execParseLink({ url: 'https://example.com', maxLength: 999_999 })
      expect(tooBig.content.length).toBe(50_000)
    })

    it('routes to provider.parseLink and forwards abortSignal', async () => {
      const parseLinkMock = vi.fn().mockResolvedValue({
        url: 'https://example.com',
        title: 'Tavily Title',
        content: 'Extracted page content.',
      })
      getParseLinkProviderMock.mockReturnValue({ parseLink: parseLinkMock })
      const controller = new AbortController()

      const result = await execParseLink({ url: 'https://example.com' }, controller.signal)

      expect(parseLinkMock).toHaveBeenCalledWith('https://example.com', controller.signal)
      expect(result).toEqual({
        url: 'https://example.com',
        title: 'Tavily Title',
        content: 'Extracted page content.',
        originalLength: 'Extracted page content.'.length,
        truncated: false,
      })
    })

    it('propagates underlying provider errors (e.g. missing API key)', async () => {
      const apiKeyError = ChatboxAIAPIError.fromCodeName('tavily_api_key_required', 'tavily_api_key_required')
      getParseLinkProviderMock.mockImplementation(() => {
        throw apiKeyError
      })

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'tavily_api_key_required' },
      })
    })

    it('throws parse_link_not_supported when no provider has the capability', async () => {
      getParseLinkProviderMock.mockReturnValue(null)

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'parse_link_not_supported' },
      })
    })

    it('throws parse_link_failed when provider returns null', async () => {
      getParseLinkProviderMock.mockReturnValue({ parseLink: vi.fn().mockResolvedValue(null) })

      await expect(execParseLink({ url: 'https://example.com' })).rejects.toMatchObject({
        detail: { name: 'parse_link_failed' },
      })
    })

    it('truncates third-party result to maxLength', async () => {
      const longContent = 'b'.repeat(15_000)
      getParseLinkProviderMock.mockReturnValue({
        parseLink: vi.fn().mockResolvedValue({
          url: 'https://example.com',
          title: 't',
          content: longContent,
        }),
      })

      const result = await execParseLink({ url: 'https://example.com', maxLength: 5_000 })

      expect(result.content.length).toBe(5_000)
      expect(result.originalLength).toBe(15_000)
      expect(result.truncated).toBe(true)
    })
  })
})
