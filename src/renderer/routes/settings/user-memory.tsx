import { Button, Stack, Text, Textarea, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getSharedUserContext,
  saveSharedUserContext,
  type SharedUserContext,
} from '@/mobile/shared-user-context'

export const Route = createFileRoute('/settings/user-memory')({ component: UserMemorySettingsPage })

function UserMemorySettingsPage() {
  const [value, setValue] = useState(getSharedUserContext)
  const [saved, setSaved] = useState(false)
  const patch = (next: Partial<SharedUserContext>) => {
    setSaved(false)
    setValue((current) => ({ ...current, ...next }))
  }

  const save = () => {
    saveSharedUserContext(value)
    setSaved(true)
  }

  return (
    <main className="yachiyo-character-settings">
      <Title order={1}>用户与记忆</Title>
      <Text c="dimmed" mb="md">
        这些内容会作为隐藏上下文用于普通聊天和 Agent，不会显示在聊天记录中。
      </Text>
      <section className="yachiyo-character-editor">
        <Textarea
          label="用户画像"
          description="填写称呼、偏好、背景和沟通习惯。"
          placeholder="例如：称呼我为 Wayne；优先使用中文回答。"
          autosize
          minRows={7}
          maxRows={16}
          value={value.userProfile}
          onChange={(event) => patch({ userProfile: event.currentTarget.value })}
        />
        <Textarea
          label="长期记忆"
          description="记录需要跨对话保留的事实和约定。"
          placeholder="例如：项目默认使用 pnpm；修改后运行 Android 检查。"
          autosize
          minRows={10}
          maxRows={22}
          value={value.memory}
          onChange={(event) => patch({ memory: event.currentTarget.value })}
        />
        <Stack gap="xs">
          <Button onClick={save}>保存用户与记忆</Button>
          {saved && (
            <Text size="sm" c="green">
              已保存，将从下一次模型请求开始生效。
            </Text>
          )}
        </Stack>
      </section>
    </main>
  )
}
