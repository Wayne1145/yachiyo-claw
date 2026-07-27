import { ActionIcon, Alert, Badge, Group, Stack, Switch, Text, Title } from '@mantine/core'
import { IconArrowLeft, IconBlocks, IconShieldLock } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeatureManifest, FeaturePlatform } from '@shared/features/contract'
import { BUILTIN_FEATURES } from '@/features/builtin-features'
import { previewFeatureToggle, setFeatureEnabled } from '@/features/feature-settings'
import { getEnabledFeatureIds, resolveRendererFeaturePlatform } from '@/features/feature-runtime'
import { router } from '@/router'
import { useSettingsStore } from '@/stores/settingsStore'
import { useInAndroidAppShell } from './AndroidAppShellContext'

const FEATURE_LABELS: Record<string, string> = {
  'core-agent': 'Agent 核心',
  mcp: 'MCP',
  'knowledge-base': '知识库',
  'session-attachment-rag': '会话附件检索',
  file: '会话文件',
  'web-search': '网络搜索',
  sandbox: '本地开发环境',
  workspace: '工作区交付',
  'android-device': '手机控制',
  'long-term-memory': '用户画像与记忆',
  camera: '摄像头工具',
  skills: 'Skills',
  plugins: '第三方插件',
  interactive: '交互式对话',
  tasks: '定时任务',
  'local-models': '本地模型',
  speech: '语音服务',
  'character-profiles': '角色设定',
  updater: '应用更新',
}

const FEATURE_DETAILS: Record<string, string> = {
  'core-agent': '工具调用、任务循环与 Agent 系统指令',
  mcp: '连接经过授权的 MCP Server',
  'knowledge-base': '桌面知识库与检索工具',
  'session-attachment-rag': '从当前对话的附件中检索相关内容',
  file: '读取用户主动附加到对话的文件与链接',
  'web-search': '使用已配置的搜索服务查询网络',
  sandbox: '在应用私有 Linux 环境中运行开发工具',
  workspace: '外部工作区同步、预览、导出与部署',
  'android-device': '通过审批后的无障碍、Shizuku 或 Root 操作手机',
  'long-term-memory': '普通聊天与 Agent 共用的长期记忆',
  camera: '在交互式会话中按需拍照供模型观察',
  skills: '加载技能说明并执行经过审批的技能脚本',
  plugins: '安装并运行第三方声明式插件',
  interactive: 'Live2D、语音和摄像头实时交互',
  tasks: '在后台按计划恢复 Agent 任务',
  'local-models': '下载并在设备上运行兼容模型',
  speech: '本地或第三方 ASR/TTS 服务',
  'character-profiles': '人格、头像、Live2D 与模型预设',
  updater: '检查、下载并安装签名一致的新版本',
}

function trustLabel(feature: FeatureManifest): { key: string; color: string } {
  if (feature.trust === 'privileged') return { key: '特权能力', color: 'red' }
  if (feature.trust === 'sandboxed') return { key: '受控能力', color: 'yellow' }
  return { key: '应用内能力', color: 'gray' }
}

export function FeatureManager() {
  const { t } = useTranslation()
  const inAndroidAppShell = useInAndroidAppShell()
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const platform = resolveRendererFeaturePlatform() as FeaturePlatform
  const enabled = useMemo(() => getEnabledFeatureIds(platform, overrides), [overrides, platform])
  const features = useMemo(() => BUILTIN_FEATURES.filter((feature) => feature.platforms.includes(platform)), [platform])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (feature: FeatureManifest, checked: boolean) => {
    setError(null)
    const preview = previewFeatureToggle(feature.id, checked, platform, overrides)
    if (checked) {
      const blocker = preview.blocked.find((item) => item.feature === feature.id)
      if (blocker) {
        setError(
          String(
            t('无法启用“{{feature}}”：请先启用 {{requirement}}。', {
              feature: t(FEATURE_LABELS[feature.id] ?? feature.displayName),
              requirement: t(FEATURE_LABELS[blocker.missingRequirement] ?? blocker.missingRequirement),
            })
          )
        )
        return
      }
    } else {
      const affected = preview.blocked
        .filter((item) => item.missingRequirement === feature.id && item.feature !== feature.id)
        .map((item) => t(FEATURE_LABELS[item.feature] ?? item.feature))
      if (
        affected.length > 0 &&
        !window.confirm(
          String(
            t('关闭“{{feature}}”后，以下依赖能力也将不可用：{{affected}}。继续吗？', {
              feature: t(FEATURE_LABELS[feature.id] ?? feature.displayName),
              affected: affected.join(String(t('、'))),
            })
          )
        )
      ) {
        return
      }
    }
    setBusyId(feature.id)
    try {
      await setFeatureEnabled(feature.id, checked, platform)
    } catch (cause) {
      setError(cause instanceof Error ? String(t(cause.message)) : String(t('功能设置保存失败')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="yachiyo-settings-subpage yachiyo-feature-manager">
      <header className="yachiyo-subpage-heading">
        {!inAndroidAppShell && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={38}
            aria-label={t('返回设置')}
            onClick={() => void router.navigate({ to: '/settings' })}
          >
            <IconArrowLeft size={21} />
          </ActionIcon>
        )}
        <span className="yachiyo-subpage-icon" aria-hidden="true">
          <IconBlocks size={22} />
        </span>
        <div>
          <Title order={2}>{t('功能模块')}</Title>
          <Text size="sm" c="dimmed">
            {t('按需启用应用能力；关闭依赖项时会先说明影响范围')}
          </Text>
        </div>
      </header>

      {error && (
        <Alert color="red" title={t('无法更改设置')}>
          {error}
        </Alert>
      )}

      <section className="yachiyo-settings-panel">
        <Stack gap={0}>
          {features.map((feature) => {
            const trust = trustLabel(feature)
            const checked = enabled.has(feature.id)
            return (
              <div className="yachiyo-feature-row" key={feature.id} data-enabled={checked ? 'true' : 'false'}>
                <div className="yachiyo-feature-copy">
                  <Group gap="xs" wrap="wrap">
                    <Text fw={650}>{t(FEATURE_LABELS[feature.id] ?? feature.displayName)}</Text>
                    <Badge
                      size="xs"
                      color={trust.color}
                      variant="light"
                      leftSection={feature.trust === 'privileged' ? <IconShieldLock size={11} /> : undefined}
                    >
                      {t(trust.key)}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t(FEATURE_DETAILS[feature.id] ?? feature.description)}
                  </Text>
                  {feature.requires?.length ? (
                    <Text size="xs" c="dimmed">
                      {t('依赖：{{dependencies}}', {
                        dependencies: feature.requires.map((id) => t(FEATURE_LABELS[id] ?? id)).join(String(t('、'))),
                      })}
                    </Text>
                  ) : null}
                </div>
                <Switch
                  aria-label={String(
                    t(checked ? '关闭 {{feature}}' : '启用 {{feature}}', {
                      feature: t(FEATURE_LABELS[feature.id] ?? feature.displayName),
                    })
                  )}
                  checked={checked}
                  disabled={busyId !== null}
                  onChange={(event) => void toggle(feature, event.currentTarget.checked)}
                />
              </div>
            )
          })}
        </Stack>
      </section>
    </main>
  )
}
