import { describe, expect, it } from 'vitest'
import { yachiyoUtilityEnglish, yachiyoUtilityTraditionalChinese } from './yachiyo-resources-utility'

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)].map((match) => match[1]).sort()
}

describe('utility page translations', () => {
  it('keeps English and Traditional Chinese resource keys in sync', () => {
    expect(Object.keys(yachiyoUtilityTraditionalChinese).sort()).toEqual(Object.keys(yachiyoUtilityEnglish).sort())
  })

  it('preserves interpolation parameters in every translation', () => {
    for (const [key, english] of Object.entries(yachiyoUtilityEnglish)) {
      expect(interpolationTokens(english), `English interpolation mismatch for ${key}`).toEqual(
        interpolationTokens(key)
      )
      expect(
        interpolationTokens(yachiyoUtilityTraditionalChinese[key]),
        `Traditional Chinese interpolation mismatch for ${key}`
      ).toEqual(interpolationTokens(key))
    }
  })

  it('translates persisted built-in download task titles', () => {
    expect(yachiyoUtilityEnglish['Linux 沙箱基础环境']).toBe('Linux sandbox base environment')
    expect(yachiyoUtilityTraditionalChinese['Linux 沙箱基础环境']).toBe('Linux 沙箱基礎環境')
  })
})
