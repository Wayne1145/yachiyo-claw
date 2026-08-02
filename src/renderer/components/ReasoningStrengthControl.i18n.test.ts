import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yachiyoResources } from '@/i18n/yachiyo-resources'

const source = fs.readFileSync(path.join(__dirname, 'ReasoningStrengthControl.tsx'), 'utf8')

describe('ReasoningStrengthControl translations', () => {
  it('routes labels and accessibility copy through the Yachiyo catalog', () => {
    expect(source).toContain("import { useTranslation } from 'react-i18next'")
    expect(source).not.toContain('aria-label="推理强度"')
    const literalKeys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1])
    expect(literalKeys.filter((key) => !(key in yachiyoResources.en))).toEqual([])
    expect(yachiyoResources.en['不思考']).toBe('Off')
  })
})
