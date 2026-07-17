import { describe, expect, it, vi } from 'vitest'
import { getSearchAcceptLanguage } from './accept-language'

const mockSettings = vi.hoisted(() => ({
  language: 'en',
}))

vi.mock('@/stores/settingActions', () => ({
  getLanguage: () => mockSettings.language,
}))

describe('getSearchAcceptLanguage', () => {
  it('maps English app language to English search preference', () => {
    mockSettings.language = 'en'

    expect(getSearchAcceptLanguage()).toBe('en-US,en;q=0.9')
  })

  it('maps Simplified Chinese app language to zh-CN search preference', () => {
    mockSettings.language = 'zh-Hans'

    expect(getSearchAcceptLanguage()).toBe('zh-CN,zh;q=0.9,en;q=0.8')
  })

  it('maps Traditional Chinese app language to zh-TW search preference', () => {
    mockSettings.language = 'zh-Hant'

    expect(getSearchAcceptLanguage()).toBe('zh-TW,zh-HK;q=0.9,zh;q=0.8,en;q=0.7')
  })
})
