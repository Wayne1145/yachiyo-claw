import {
  IconBook,
  IconBlocks,
  IconBrain,
  IconDeviceDesktopAnalytics,
  IconListCheck,
  IconMessageCircle,
  IconMicrophone,
  IconNotebook,
  IconSettings,
  IconSparkles,
  IconTerminal2,
  IconUserHeart,
  IconWand,
  IconWorldSearch,
  IconCode,
  IconPuzzle,
} from '@tabler/icons-react'
import type { FeatureUiContribution } from './ui-contract'
import { hasFeatureUi, registerFeatureUi } from './ui-registry'

const BUILTIN_UI: readonly FeatureUiContribution[] = [
  {
    featureId: 'mobile-vibe-coding-v1',
    tab: { id: 'develop', label: '开发', icon: IconCode, order: 250, route: '/develop' },
    ownedRoutes: ['/develop', '/develop/*'],
  },
  {
    featureId: 'tasks',
    tab: { id: 'tasks', label: '任务', icon: IconListCheck, order: 300, route: '/tasks' },
    ownedRoutes: ['/tasks'],
  },
  {
    featureId: 'core',
    tabs: [
      { id: 'chat', label: '聊天', icon: IconMessageCircle, order: 100, route: '/' },
      { id: 'settings', label: '设置', icon: IconSettings, order: 400, route: '/settings' },
    ],
    settingsEntries: [
      {
        group: 'app',
        label: '功能模块',
        desktopLabel: 'Feature Modules',
        detail: '启用或关闭内置能力',
        icon: IconBlocks,
        route: '/settings/features',
        order: 350,
      },
    ],
    ownedRoutes: ['/', '/session/*', '/task/*', '/settings/features', '/about'],
  },
  {
    featureId: 'plugins',
    settingsEntries: [
      {
        group: 'capability',
        label: '插件',
        desktopLabel: 'Plugins',
        detail: '安装并管理第三方插件',
        icon: IconPuzzle,
        route: '/settings/plugins',
        order: 400,
      },
    ],
    ownedRoutes: ['/settings/plugins', '/plugin/*'],
  },
  {
    featureId: 'interactive',
    tab: { id: 'interactive', label: '交互式', icon: IconSparkles, order: 200, route: '/interactive' },
    ownedRoutes: ['/interactive'],
  },
  {
    featureId: 'local-models',
    settingsEntries: [
      {
        group: 'model',
        label: '本地模型',
        desktopLabel: 'Local Models',
        detail: '搜索、下载并在设备上运行模型',
        icon: IconDeviceDesktopAnalytics,
        route: '/settings/local-models',
        order: 400,
      },
    ],
    ownedRoutes: ['/settings/local-models'],
  },
  {
    featureId: 'web-search',
    settingsEntries: [
      {
        group: 'capability',
        label: '网络搜索',
        desktopLabel: 'Web Search',
        detail: '默认使用 Bing',
        icon: IconWorldSearch,
        route: '/settings/web-search',
        order: 100,
      },
    ],
    ownedRoutes: ['/settings/web-search'],
  },
  {
    featureId: 'knowledge-base',
    settingsEntries: [
      {
        group: 'capability',
        label: '知识库',
        desktopLabel: 'Knowledge Base',
        detail: '管理桌面知识库与检索模型',
        icon: IconBook,
        route: '/settings/knowledge-base',
        order: 150,
      },
    ],
    ownedRoutes: ['/settings/knowledge-base'],
  },
  {
    featureId: 'skills',
    settingsEntries: [
      {
        group: 'capability',
        label: 'Skills',
        detail: '安装与管理 Agent 技能',
        icon: IconWand,
        route: '/settings/skills',
        order: 200,
      },
    ],
    ownedRoutes: ['/settings/skills'],
  },
  {
    featureId: 'mcp',
    settingsEntries: [
      {
        group: 'capability',
        label: 'MCP Server',
        desktopLabel: 'MCP',
        detail: '连接 HTTP 与 SSE 服务',
        icon: IconBrain,
        route: '/settings/mcp',
        order: 300,
      },
    ],
    ownedRoutes: ['/settings/mcp'],
  },
  {
    featureId: 'sandbox',
    settingsEntries: [
      {
        group: 'capability',
        label: '本地开发环境',
        desktopLabel: 'Local Development Environment',
        detail: 'Alpine Linux、Python、Node.js 与 Git',
        icon: IconTerminal2,
        route: '/settings/developer-environment',
        order: 500,
        platforms: ['android'],
      },
    ],
    ownedRoutes: ['/settings/developer-environment'],
  },
  {
    featureId: 'character-profiles',
    settingsEntries: [
      {
        group: 'app',
        label: '角色设定',
        desktopLabel: 'Character Profiles',
        detail: '人格、头像、Live2D 与默认模型',
        icon: IconUserHeart,
        route: '/settings/characters',
        order: 100,
      },
    ],
    ownedRoutes: ['/settings/characters'],
  },
  {
    featureId: 'long-term-memory',
    settingsEntries: [
      {
        group: 'app',
        label: '用户与记忆',
        desktopLabel: 'User & Memory',
        detail: '普通聊天与 Agent 共享的用户画像和长期记忆',
        icon: IconNotebook,
        route: '/settings/user-memory',
        order: 200,
      },
    ],
    ownedRoutes: ['/settings/user-memory'],
  },
  {
    featureId: 'speech',
    settingsEntries: [
      {
        group: 'app',
        label: '语音服务',
        desktopLabel: 'Speech Services',
        detail: 'ASR、TTS、模型与音色',
        icon: IconMicrophone,
        route: '/settings/speech',
        order: 300,
      },
    ],
    ownedRoutes: ['/settings/speech'],
  },
] as const

export function registerBuiltinFeatureUi(): void {
  for (const contribution of BUILTIN_UI) {
    if (!hasFeatureUi(contribution.featureId)) registerFeatureUi(contribution)
  }
}
