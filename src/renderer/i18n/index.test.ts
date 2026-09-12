import { describe, expect, it } from 'vitest'
import i18n from './index'
import { yachiyoResources } from './yachiyo-resources'

const YACHIYO_SAMPLE_KEYS = ['聊天设置', '主题外观', '通用设置', '设置', '聊天']

describe('yachiyo i18n resources (issue #6)', () => {
  it('keeps Chinese keys intact for zh-Hans', async () => {
    await i18n.changeLanguage('zh-Hans')
    for (const key of YACHIYO_SAMPLE_KEYS) {
      expect(i18n.t(key)).toBe(key)
    }
  })

  it('translates Chinese keys to English for en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('聊天')).toBe('Chat')
    expect(i18n.t('聊天设置')).toBe('Chat settings')
  })

  // Yachiyo custom pages only ship Chinese/English resources; every other
  // language must fall back to the complete English catalog instead of
  // rendering raw Chinese keys (issue #6: language switch only changed the
  // settings menu while Yachiyo pages stayed untranslated).
  it.each(['ja', 'ko', 'ru', 'de', 'fr', 'pt-PT', 'es', 'ar', 'it-IT', 'sv', 'nb-NO'])(
    'resolves yachiyo-only keys for %s through the English fallback',
    async (language) => {
      await i18n.changeLanguage(language)
      expect(i18n.t('聊天设置')).toBe('Chat settings')
      expect(i18n.t('主题外观')).toBe('Themes')
      // Upstream chatbox translations for that language must still win.
      expect(i18n.t('General Settings')).not.toBe('General Settings')
    }
  )

  it('provides english resources for every chinese yachiyo key', () => {
    const chineseKeys = Object.keys(yachiyoResources['zh-Hans'])
    expect(chineseKeys.length).toBeGreaterThan(0)
    for (const key of chineseKeys) {
      expect(typeof yachiyoResources.en[key]).toBe('string')
    }
  })
})
