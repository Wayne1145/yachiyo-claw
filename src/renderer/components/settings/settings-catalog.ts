import type { FeatureIcon } from '@/features/ui-contract'
import {
  IconAdjustments,
  IconDownload,
  IconFileText,
  IconInfoCircle,
  IconKeyboard,
  IconMessages,
  IconPalette,
  IconPlugConnected,
  IconRobot,
  IconSparkles,
  IconTestPipe,
} from '@tabler/icons-react'

export interface SettingsEntry {
  route: string
  label: string
  detail: string
  icon: FeatureIcon
  group: string
  order: number
  keywords?: string
}

export const SETTINGS_GROUPS = [
  { id: 'personal', title: '外观与交互' },
  { id: 'model', title: '模型与连接' },
  { id: 'capability', title: 'Agent 与扩展' },
  { id: 'app', title: '应用与数据' },
  { id: 'developer', title: '开发者' },
] as const

export const CORE_SETTINGS: SettingsEntry[] = [
  {
    route: '/settings/themes',
    label: '主题外观',
    detail: '配色、明暗模式与文字大小',
    icon: IconPalette,
    group: 'personal',
    order: 0,
    keywords: 'theme appearance glass dark light font 主题 玻璃 字体',
  },
  {
    route: '/settings/chat',
    label: '聊天设置',
    detail: '消息、渲染与上下文',
    icon: IconMessages,
    group: 'personal',
    order: 50,
    keywords: 'markdown avatar context 上下文 头像',
  },
  {
    route: '/settings/provider/yachiyo',
    label: 'Yachiyo API',
    detail: '固定服务地址与模型列表',
    icon: IconSparkles,
    group: 'model',
    order: 100,
  },
  {
    route: '/settings/provider',
    label: '其他 API',
    detail: 'OpenAI、Claude 与本地模型',
    icon: IconPlugConnected,
    group: 'model',
    order: 200,
    keywords: 'api key 服务商 密钥',
  },
  {
    route: '/settings/default-models',
    label: '默认模型',
    detail: '聊天、Agent 与辅助任务',
    icon: IconRobot,
    group: 'model',
    order: 300,
  },
  {
    route: '/settings/document-parser',
    label: 'Document Parser',
    detail: '文件解析与识别服务',
    icon: IconFileText,
    group: 'capability',
    order: 180,
  },
  {
    route: '/settings/downloads',
    label: '下载管理',
    detail: '查看、暂停或继续应用内下载任务',
    icon: IconDownload,
    group: 'app',
    order: 100,
  },
  {
    route: '/settings/general',
    label: '通用设置',
    detail: '语言、启动与数据备份',
    icon: IconAdjustments,
    group: 'app',
    order: 200,
    keywords: 'language backup restore import export proxy 语言 备份 恢复 导入 导出 代理',
  },
  {
    route: '/about',
    label: '关于 Yachiyo Claw',
    detail: '版本与开源信息',
    icon: IconInfoCircle,
    group: 'app',
    order: 700,
    keywords: 'update version 更新 版本',
  },
]

export const HOTKEY_SETTINGS: SettingsEntry = {
  route: '/settings/hotkeys',
  label: 'Keyboard Shortcuts',
  detail: 'Keyboard Shortcuts',
  icon: IconKeyboard,
  group: 'personal',
  order: 800,
}
export const DEVELOPER_SETTINGS: SettingsEntry = {
  route: '/settings/plugin-runtime-test',
  label: '插件运行时测试',
  detail: '验证 Blob Worker 隔离与 RPC 协议',
  icon: IconTestPipe,
  group: 'developer',
  order: 100,
}

export function settingsGroup(entry: SettingsEntry): string {
  if (['/settings/characters', '/settings/speech', '/settings/user-memory'].includes(entry.route)) return 'personal'
  if (entry.route === '/settings/features') return 'capability'
  return entry.group
}

export function filterSettings(
  entries: SettingsEntry[],
  query: string,
  translate: (key: string) => string
): SettingsEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    const text = [
      entry.label,
      entry.detail,
      translate(entry.label),
      translate(entry.detail),
      entry.keywords,
      entry.route,
    ]
      .join(' ')
      .toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  })
}
