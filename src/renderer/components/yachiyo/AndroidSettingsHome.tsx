import { Text, Title } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import type { TablerIcon } from '@tabler/icons-react'
import {
  IconAdjustments,
  IconChevronRight,
  IconMessages,
  IconPlugConnected,
  IconRobot,
  IconSettings,
  IconSparkles,
  IconDownload,
  IconPalette,
  IconPuzzle,
  IconTestPipe,
} from '@tabler/icons-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { registerBuiltinFeatureUi } from '@/features/builtin-feature-ui'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { getSettingsEntries } from '@/features/ui-registry'
import { router } from '@/router'
import { usePluginStore } from '@/plugins/plugin-manager'
import { useSettingsStore } from '@/stores/settingsStore'

interface SettingsItem {
  label: string
  detail: string
  icon: TablerIcon
  order: number
  open: () => void
}

const CORE_GROUPS: Array<{ id: 'model' | 'capability' | 'app' | 'developer'; title: string; items: SettingsItem[] }> = [
  {
    id: 'model',
    title: '模型与连接',
    items: [
      {
        label: 'Yachiyo API',
        detail: '固定服务地址与模型列表',
        icon: IconSparkles,
        order: 100,
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
        order: 200,
        open: () => void router.navigate({ to: '/settings/provider' }),
      },
      {
        label: '默认模型',
        detail: '聊天、Agent 与辅助任务',
        icon: IconRobot,
        order: 300,
        open: () => void router.navigate({ to: '/settings/default-models' }),
      },
      {
        label: '下载管理',
        detail: '查看、暂停或继续应用内下载任务',
        icon: IconDownload,
        order: 500,
        open: () => void router.navigate({ to: '/settings/downloads' }),
      },
    ],
  },
  {
    id: 'capability',
    title: '能力',
    items: [],
  },
  {
    id: 'app',
    title: '应用',
    items: [
      {
        label: '聊天设置',
        detail: '消息、渲染与上下文',
        icon: IconMessages,
        order: 400,
        open: () => void router.navigate({ to: '/settings/chat' }),
      },
      {
        label: '主题外观',
        detail: '安装并切换第三方配色主题',
        icon: IconPalette,
        order: 500,
        open: () => void router.navigate({ to: '/settings/themes' }),
      },
      {
        label: '通用设置',
        detail: '语言、外观与数据',
        icon: IconAdjustments,
        order: 600,
        open: () => void router.navigate({ to: '/settings/general' }),
      },
      {
        label: '关于 Yachiyo Claw',
        detail: '版本与开源信息',
        icon: IconSettings,
        order: 700,
        open: () => void router.navigate({ to: '/about' }),
      },
    ],
  },
  {
    id: 'developer',
    title: '开发者',
    items: [
      {
        label: '插件运行时测试',
        detail: '验证 Blob Worker 隔离与 RPC 协议',
        icon: IconTestPipe,
        order: 100,
        open: () => void router.navigate({ to: '/settings/plugin-runtime-test' }),
      },
    ],
  },
]

export function AndroidSettingsHome() {
  const { t } = useTranslation()
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const plugins = usePluginStore((state) => state.installed)
  const contributionPluginIds = usePluginStore((state) => state.contributionPluginIds)
  const groups = useMemo(() => {
    registerBuiltinFeatures()
    registerBuiltinFeatureUi()
    const enabledFeatureIds = getEnabledFeatureIds('android', overrides)
    return CORE_GROUPS.filter((group) => group.id !== 'developer' || process.env.NODE_ENV === 'development').map(
      (group) => {
        const contributed =
          group.id === 'developer'
            ? []
            : getSettingsEntries(group.id, { platform: 'android', enabledFeatureIds }).map((entry) => ({
                label: entry.label,
                detail: entry.detail,
                icon: entry.icon as TablerIcon,
                order: entry.order,
                open: () => void router.navigate({ to: entry.route as '/' }),
              }))
        const allowedContributions = new Set(contributionPluginIds)
        const pluginEntries = (enabledFeatureIds.has('plugins') ? plugins : [])
          .filter((record) => allowedContributions.has(record.manifest.id))
          .flatMap((record) => record.manifest.contributions.settingsEntries ?? [])
          .filter((entry) => entry.group === group.id)
          .map((entry) => ({
            label: entry.label,
            detail: entry.detail,
            icon: IconPuzzle,
            order: entry.order,
            open: () => void router.navigate({ to: entry.route as '/' }),
          }))
        return { ...group, items: [...group.items, ...contributed, ...pluginEntries].sort((a, b) => a.order - b.order) }
      },
    )
  }, [contributionPluginIds, overrides, plugins])
  return (
    <main className="yachiyo-settings-home">
      <header className="yachiyo-settings-heading">
        <Title order={1}>{t('设置')}</Title>
        <Text c="dimmed">Yachiyo Claw</Text>
      </header>

      {groups.map((group) => (
        <section key={group.title} className="yachiyo-settings-group">
          <Text className="yachiyo-settings-group-title">{t(group.title)}</Text>
          <div className="yachiyo-settings-list">
            {group.items.map((item, index) => {
              const Icon = item.icon
              return (
                <button
                  key={`${item.order}:${item.label}:${index}`}
                  type="button"
                  className="yachiyo-settings-item"
                  onClick={item.open}
                >
                  <span className="yachiyo-settings-icon">
                    <Icon size={20} stroke={1.8} />
                  </span>
                  <span className="yachiyo-settings-copy">
                    <strong>{t(item.label)}</strong>
                    <small>{t(item.detail)}</small>
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
