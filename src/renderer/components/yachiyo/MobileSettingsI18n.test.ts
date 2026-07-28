import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yachiyoResources } from '@/i18n/yachiyo-resources'

const componentPaths = [
  'MobileUpdateDialog.tsx',
  'DownloadsCenter.tsx',
  'CharacterSelector.tsx',
  'PluginRuntimeTest.tsx',
  '../../routes/settings/speech.tsx',
  '../../routes/settings/characters.tsx',
  '../../routes/settings/user-memory.tsx',
  '../../routes/settings/developer-environment.tsx',
]

describe('mobile settings i18n contract', () => {
  it.each(componentPaths)('%s has an English resource for every Chinese string literal', (componentPath) => {
    const source = fs.readFileSync(path.resolve(__dirname, componentPath), 'utf8')
    expect(source).toContain("from 'react-i18next'")
    const keys = [...source.matchAll(/['"]([^'"\r\n]*\p{Script=Han}[^'"\r\n]*)['"]/gu)].map((match) => match[1])
    expect(keys.filter((key) => !(key in yachiyoResources.en))).toEqual([])
  })
})
