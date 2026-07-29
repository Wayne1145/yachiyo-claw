import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yachiyoMiscEnglish } from './yachiyo-resources-misc'
import { yachiyoResources } from './yachiyo-resources'

const componentNames = [
  'AgentApprovalDialog.tsx',
  'AgentConfigurationPanel.tsx',
  'AndroidWorkspaceDeliveryPanel.tsx',
  'FeatureManager.tsx',
  'Live2DStage.tsx',
]

const componentDirectory = path.resolve(__dirname, '../components/yachiyo')

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)].map((match) => match[1]).sort()
}

describe('miscellaneous Yachiyo component translations', () => {
  it.each(componentNames)('%s routes static user-facing copy through react-i18next', (componentName) => {
    const source = fs.readFileSync(path.join(componentDirectory, componentName), 'utf8')
    expect(source).toContain("import { useTranslation } from 'react-i18next'")
    expect(source).toContain('useTranslation()')

    const literalKeys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1])
    expect(literalKeys.length).toBeGreaterThan(0)
    expect(literalKeys.filter((key) => !(key in yachiyoMiscEnglish))).toEqual([])
  })

  it('covers map-backed feature labels and descriptions', () => {
    const source = fs.readFileSync(path.join(componentDirectory, 'FeatureManager.tsx'), 'utf8')
    const mapBlocks = [...source.matchAll(/const FEATURE_(?:LABELS|DETAILS):[^=]+\= \{([\s\S]*?)\n\}/g)]
    const keys = mapBlocks.flatMap((block) => [...block[1].matchAll(/:\s*'([^']+)'/g)].map((match) => match[1]))

    expect(mapBlocks).toHaveLength(2)
    expect(keys.length).toBeGreaterThan(30)
    expect(keys.filter((key) => !(key in yachiyoMiscEnglish))).toEqual([])
  })

  it('keeps dynamic keys and every interpolation token intact', () => {
    const dynamicKeys = [
      'Agent 循环保护',
      'Agent 操作审批',
      '停止',
      '拒绝',
      '继续一次',
      '仅本次允许',
      '更换策略',
      '此对话允许',
      '关闭 {{feature}}',
      '启用 {{feature}}',
      'workspace_operation_failed',
      'external_workspace_unavailable',
      'workspace_sync_in_failed',
      'sandbox_init_failed',
    ]
    expect(dynamicKeys.filter((key) => !(key in yachiyoMiscEnglish))).toEqual([])

    for (const [key, english] of Object.entries(yachiyoMiscEnglish)) {
      expect(english.trim().length, `Empty English translation for ${key}`).toBeGreaterThan(0)
      expect(interpolationTokens(english), `English interpolation mismatch for ${key}`).toEqual(
        interpolationTokens(key)
      )
    }

    expect(yachiyoMiscEnglish['当前人格：{{name}}']).toBe('Current personality: {{name}}')
    expect(yachiyoMiscEnglish['Live2D ZIP 文件不存在：{{path}}']).toContain('{{path}}')
  })

  it('covers Agent workspace status and empty-state copy', () => {
    expect(yachiyoResources.en['Agent 控制']).toBe('Agent controls')
    expect(yachiyoResources.en['内部工具 Agent']).toBe('Internal-tools Agent')
    expect(yachiyoResources.en['无障碍设备 Agent']).toBe('Accessibility device Agent')
    expect(yachiyoResources.en['描述你希望完成的任务，Agent 可使用内部工具、Skills、MCP 和 Linux 沙箱。']).toContain(
      'Linux sandbox'
    )
    expect(yachiyoResources.en['仅聊天：当前模型未声明 Agent 工具调用能力']).toContain('Chat only')
  })
})
