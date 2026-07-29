import {
  ActionIcon,
  Button,
  Flex,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconBook2, IconBrain, IconPlugConnected, IconUserCog, IconWand } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { type AgentBackend, getAgentBackend, setAgentBackend as persistAgentBackend } from '@/mobile/agent-broker'
import { type AgentProfile, getAgentProfileState, saveAgentProfileState } from '@/mobile/agent-profile'
import { router } from '@/router'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'

export function AgentConfigurationPanel({
  onBackendChange,
  showAccessBackend = true,
}: {
  onBackendChange?: (backend: AgentBackend) => void
  showAccessBackend?: boolean
}) {
  const { t } = useTranslation()
  const [backend, setBackend] = useState<AgentBackend>(getAgentBackend)
  const [profileState, setProfileState] = useState(getAgentProfileState)
  const [editorOpened, setEditorOpened] = useState(false)
  const activeProfile =
    profileState.profiles.find((profile) => profile.id === profileState.activeProfileId) || profileState.profiles[0]

  const changeBackend = (value: string) => {
    const next = value as AgentBackend
    persistAgentBackend(next)
    setBackend(next)
    onBackendChange?.(next)
  }

  const updateProfile = (patch: Partial<AgentProfile>) => {
    setProfileState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId ? { ...profile, ...patch } : profile
      ),
    }))
  }

  const saveProfiles = () => {
    saveAgentProfileState(profileState)
    setEditorOpened(false)
  }

  const duplicateProfile = () => {
    const copy: AgentProfile = {
      ...activeProfile,
      id: crypto.randomUUID(),
      name: t('{{name}} 副本', { name: activeProfile.name }),
      builtin: false,
    }
    const next = { activeProfileId: copy.id, profiles: [...profileState.profiles, copy] }
    setProfileState(next)
    saveAgentProfileState(next)
  }

  const navigationTargets = [
    { id: 'skills', label: String(t('Skills')), Icon: IconWand, priority: 90, to: '/settings/skills' },
    { id: 'mcp', label: String(t('MCP Server')), Icon: IconPlugConnected, priority: 80, to: '/settings/mcp' },
    { id: 'memory', label: String(t('记忆')), Icon: IconBrain, priority: 70, to: '/settings/user-memory' },
    { id: 'profile', label: String(t('用户画像')), Icon: IconBook2, priority: 60, to: '/settings/user-memory' },
  ] as const
  const navigationActions: AdaptiveActionDescriptor[] = navigationTargets.map(({ id, label, Icon, priority, to }) => {
    const navigate = () => void router.navigate({ to })
    return {
      id,
      label,
      icon: Icon,
      priority,
      collapseStrategy: 'icon-then-overflow',
      renderControl: ({ presentation }) =>
        presentation === 'labelled' ? (
          <Button variant="subtle" leftSection={<Icon size={17} />} onClick={navigate}>
            {label}
          </Button>
        ) : (
          <Tooltip label={label}>
            <ActionIcon size={44} variant="subtle" aria-label={label} onClick={navigate}>
              <Icon size={18} />
            </ActionIcon>
          </Tooltip>
        ),
      menuAction: { onSelect: navigate },
    }
  })

  return (
    <>
      {showAccessBackend && (
        <section className="yachiyo-agent-config-panel">
          <div>
            <Title order={2}>{t('手机控制后端')}</Title>
            <Text c="dimmed" size="sm">
              {t('Root 和 Shizuku 提供 Shell；无障碍提供界面观察与交互。')}
            </Text>
          </div>
          <SegmentedControl
            fullWidth
            value={backend}
            onChange={changeBackend}
            data={[
              { value: 'root', label: t('Root') },
              { value: 'shizuku', label: t('Shizuku') },
              { value: 'accessibility', label: t('无障碍') },
            ]}
          />
        </section>
      )}

      <section className="yachiyo-agent-config-panel">
        <Flex className="yachiyo-agent-config-heading" justify="space-between" align="center" gap="sm" wrap="wrap">
          <div className="yachiyo-agent-config-heading-copy">
            <Title order={2}>{t('Agent 配置')}</Title>
            <Text c="dimmed" size="sm">
              {t('当前人格：{{name}}', { name: activeProfile.name })}
            </Text>
          </div>
          <Button variant="light" leftSection={<IconUserCog size={17} />} onClick={() => setEditorOpened(true)}>
            {t('编辑')}
          </Button>
        </Flex>
        <AdaptiveActionCluster
          className="yachiyo-agent-feature-actions"
          ariaLabel={String(t('Agent 配置'))}
          actions={navigationActions}
        />
      </section>

      <AdaptiveModal
        opened={editorOpened}
        onClose={() => setEditorOpened(false)}
        title={t('Agent 人格')}
        centered
        size="lg"
      >
        <Stack gap="md">
          <Flex gap="xs" align="flex-end" wrap="wrap">
            <Select
              className="yachiyo-agent-profile-picker"
              label={t('人格')}
              flex={1}
              allowDeselect={false}
              value={profileState.activeProfileId}
              data={profileState.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              onChange={(value) => value && setProfileState((current) => ({ ...current, activeProfileId: value }))}
            />
            <Button variant="light" onClick={duplicateProfile}>
              {t('新建副本')}
            </Button>
          </Flex>
          <TextInput
            label={t('名称')}
            value={activeProfile.name}
            onChange={(event) => updateProfile({ name: event.currentTarget.value })}
          />
          <Textarea
            autosize
            minRows={12}
            maxRows={22}
            label={t('Soul')}
            value={activeProfile.soul}
            placeholder={String(t('人格与行为原则'))}
            onChange={(event) => updateProfile({ soul: event.currentTarget.value })}
          />
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => setEditorOpened(false)}>
              {t('取消')}
            </Button>
            <Button onClick={saveProfiles}>{t('保存')}</Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>
    </>
  )
}
