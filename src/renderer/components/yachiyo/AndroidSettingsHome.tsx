import { Text, Title } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import type { TablerIcon } from '@tabler/icons-react'
import {
  IconAdjustments,
  IconBrain,
  IconUserHeart,
  IconMicrophone,
  IconChevronRight,
  IconMessages,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconWand,
} from '@tabler/icons-react'
import { router } from '@/router'

interface SettingsItem {
  label: string
  detail: string
  icon: TablerIcon
  open: () => void
}

const GROUPS: Array<{ title: string; items: SettingsItem[] }> = [
  {
    title: '模型与连接',
    items: [
      {
        label: 'Yachiyo API',
        detail: '固定服务地址与模型列表',
        icon: IconSparkles,
        open: () =>
          void router.navigate({
            to: '/settings/provider/$providerId',
            params: { providerId: ModelProviderEnum.Yachiyo },
          }),
      },
      {
        label: '其他 API',
        detail: 'OpenAI、Claude 与本地模型',
        icon: IconPlugConnected,
        open: () => void router.navigate({ to: '/settings/provider' }),
      },
      {
        label: '默认模型',
        detail: '聊天、Agent 与辅助任务',
        icon: IconRobot,
        open: () => void router.navigate({ to: '/settings/default-models' }),
      },
    ],
  },
  {
    title: '能力',
    items: [
      {
        label: '网络搜索',
        detail: '默认使用 Bing',
        icon: IconSearch,
        open: () => void router.navigate({ to: '/settings/web-search' }),
      },
      {
        label: 'Skills',
        detail: '安装与管理 Agent 技能',
        icon: IconWand,
        open: () => void router.navigate({ to: '/settings/skills' }),
      },
      {
        label: 'MCP Server',
        detail: '连接 HTTP 与 SSE 服务',
        icon: IconBrain,
        open: () => void router.navigate({ to: '/settings/mcp' }),
      },
    ],
  },
  {
    title: '应用',
    items: [
      {
        label: '角色设定',
        detail: '人格、头像、Live2D 与默认模型',
        icon: IconUserHeart,
        open: () => void router.navigate({ to: '/settings/characters' }),
      },
      {
        label: '语音服务',
        detail: 'ASR、TTS、模型与音色',
        icon: IconMicrophone,
        open: () => void router.navigate({ to: '/settings/speech' }),
      },
      {
        label: '聊天设置',
        detail: '消息、渲染与上下文',
        icon: IconMessages,
        open: () => void router.navigate({ to: '/settings/chat' }),
      },
      {
        label: '通用设置',
        detail: '语言、外观与数据',
        icon: IconAdjustments,
        open: () => void router.navigate({ to: '/settings/general' }),
      },
      {
        label: '关于 Yachiyo Claw',
        detail: '版本与开源信息',
        icon: IconSettings,
        open: () => void router.navigate({ to: '/about' }),
      },
    ],
  },
]

export function AndroidSettingsHome() {
  return (
    <main className="yachiyo-settings-home">
      <header className="yachiyo-settings-heading">
        <Title order={1}>设置</Title>
        <Text c="dimmed">Yachiyo Claw</Text>
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="yachiyo-settings-group">
          <Text className="yachiyo-settings-group-title">{group.title}</Text>
          <div className="yachiyo-settings-list">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <button key={item.label} type="button" className="yachiyo-settings-item" onClick={item.open}>
                  <span className="yachiyo-settings-icon">
                    <Icon size={20} stroke={1.8} />
                  </span>
                  <span className="yachiyo-settings-copy">
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <IconChevronRight size={19} stroke={1.7} />
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </main>
  )
}
