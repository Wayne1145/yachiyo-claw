import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yachiyoCatalogEnglish } from '@/i18n/yachiyo-resources-catalogs'

const componentNames = ['LocalModelCenter.tsx', 'PluginCenter.tsx']

function interpolationNames(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]).sort()
}

describe('Yachiyo catalog pages i18n contract', () => {
  it.each(componentNames)('%s routes its Simplified Chinese catalog through react-i18next', (componentName) => {
    const source = fs.readFileSync(path.join(__dirname, componentName), 'utf8')
    expect(source).toContain("import { useTranslation } from 'react-i18next'")
    expect(source).toContain('useTranslation()')

    const chineseStrings = [...source.matchAll(/'([^'\r\n]*\p{Script=Han}[^'\r\n]*)'/gu)].map((match) =>
      match[1].replaceAll('\\n', '\n'),
    )
    expect(chineseStrings.length).toBeGreaterThan(20)
    expect(chineseStrings.filter((key) => !(key in yachiyoCatalogEnglish))).toEqual([])
  })

  it('provides natural, non-empty English translations with matching interpolation names', () => {
    expect(Object.keys(yachiyoCatalogEnglish).length).toBeGreaterThan(180)
    expect(Object.values(yachiyoCatalogEnglish).every((translation) => translation.trim().length > 0)).toBe(true)

    for (const [key, translation] of Object.entries(yachiyoCatalogEnglish)) {
      expect(interpolationNames(translation), key).toEqual(interpolationNames(key))
    }
  })
})
