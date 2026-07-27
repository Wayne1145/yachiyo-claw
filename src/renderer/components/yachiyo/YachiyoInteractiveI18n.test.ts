import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yachiyoInteractiveEnglish } from '@/i18n/yachiyo-resources-interactive'

const componentNames = ['AndroidInteractive.tsx', 'AndroidPermissionWizard.tsx', 'YachiyoApiOnboarding.tsx']

describe('Yachiyo interactive Android i18n contract', () => {
  it.each(componentNames)('%s routes static user-facing copy through react-i18next', (componentName) => {
    const source = fs.readFileSync(path.join(__dirname, componentName), 'utf8')
    expect(source).toContain("import { useTranslation } from 'react-i18next'")
    expect(source).toContain('useTranslation()')

    const keys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1])
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => !(key in yachiyoInteractiveEnglish))).toEqual([])
  })

  it('keeps English translations natural and non-empty', () => {
    expect(Object.keys(yachiyoInteractiveEnglish).length).toBeGreaterThan(70)
    expect(Object.values(yachiyoInteractiveEnglish).every((translation) => translation.trim().length > 0)).toBe(true)
    expect(yachiyoInteractiveEnglish['切换模型：{{model}}']).toBe('Switch model: {{model}}')
    expect(
      yachiyoInteractiveEnglish['{{device}} 的授权状态无法被应用可靠读取，请确认允许自启动和后台运行。']
    ).toContain('{{device}}')
  })
})
