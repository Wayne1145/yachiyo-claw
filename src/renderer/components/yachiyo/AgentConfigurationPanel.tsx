import { Button, Flex, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { IconBook2, IconBrain, IconPlugConnected, IconUserCog, IconWand } from '@tabler/icons-react'
import { useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { type AgentBackend, getAgentBackend, setAgentBackend as persistAgentBackend } from '@/mobile/agent-broker'
import { type AgentProfile, getAgentProfileState, saveAgentProfileState } from '@/mobile/agent-profile'
import { router } from '@/router'

export function AgentConfigurationPanel({
  onBackendChange,
  showAccessBackend = true,
}: {
  onBackendChange?: (backend: AgentBackend) => void
  showAccessBackend?: boolean
}) {
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
        profile.id === current.activeProfileId ? { ...profile, ...patch } : profile,
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
      name: `${activeProfile.name} 副本`,
      builtin: false,
    }
    const next = { activeProfileId: copy.id, profiles: [...profileState.profiles, copy] }
    setProfileState(next)
    saveAgentProfileState(next)
  }

  return (
    <>
      {showAccessBackend && (
        <section className="yachiyo-agent-config-panel">
          <div>
            <Title order={2}>手机控制后端</Title>
            <Text c="dimmed" size="sm">
              Root 和 Shizuku 提供 Shell；无障碍提供界面观察与交互。
            </Text>
          </div>
          <SegmentedControl
            fullWidth
            value={backend}
            onChange={changeBackend}
            data={[
              { value: 'root', label: 'Root' },
              { value: 'shizuku', label: 'Shizuku' },
              { value: 'accessibility', label: '无障碍' },
            ]}
          />
        </section>
      )}

      <section className="yachiyo-agent-config-panel">
        <Flex justify="space-between" align="center" gap="sm">
          <div>
            <Title order={2}>Agent 配置</Title>
            <Text c="dimmed" size="sm">
              当前人格：{activeProfile.name}
            </Text>
          </div>
          <Button variant="light" leftSection={<IconUserCog size={17} />} onClick={() => setEditorOpened(true)}>
            编辑
          </Button>
        </Flex>
        <div className="yachiyo-agent-feature-grid">
          <Button
            variant="subtle"
            leftSection={<IconWand size={17} />}
            onClick={() => router.navigate({ to: '/settings/skills' })}
          >
            Skills
          </Button>
          <Button
            variant="subtle"
            leftSection={<IconPlugConnected size={17} />}
            onClick={() => router.navigate({ to: '/settings/mcp' })}
          >
            MCP Server
          </Button>
          <Button
            variant="subtle"
            leftSection={<IconBrain size={17} />}
            onClick={() => {
              void router.navigate({ to: '/settings/user-memory' })
            }}
          >
            记忆
          </Button>
          <Button
            variant="subtle"
            leftSection={<IconBook2 size={17} />}
            onClick={() => {
              void router.navigate({ to: '/settings/user-memory' })
            }}
          >
            用户画像
          </Button>
        </div>
      </section>

      <AdaptiveModal opened={editorOpened} onClose={() => setEditorOpened(false)} title="Agent 人格" centered size="lg">
        <Stack gap="md">
          <Flex gap="xs" align="flex-end">
            <Select
              label="人格"
              flex={1}
              allowDeselect={false}
              value={profileState.activeProfileId}
              data={profileState.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              onChange={(value) => value && setProfileState((current) => ({ ...current, activeProfileId: value }))}
            />
            <Button variant="light" onClick={duplicateProfile}>
              新建副本
            </Button>
          </Flex>
          <TextInput
            label="名称"
            value={activeProfile.name}
            onChange={(event) => updateProfile({ name: event.currentTarget.value })}
          />
          <Textarea
            autosize
            minRows={12}
            maxRows={22}
            label="Soul"
            value={activeProfile.soul}
            placeholder="人格与行为原则"
            onChange={(event) => updateProfile({ soul: event.currentTarget.value })}
          />
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => setEditorOpened(false)}>
              取消
            </Button>
            <Button onClick={saveProfiles}>保存</Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>
    </>
  )
}
