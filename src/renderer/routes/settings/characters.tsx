import { SettingsActions, SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { Button, Select, Text, TextInput, Textarea } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listCharacterProfiles, saveCharacterProfile, type CharacterProfile } from '@/mobile/character-profiles'

export const Route = createFileRoute('/settings/characters')({ component: CharactersSettings })

function CharactersSettings() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState(listCharacterProfiles)
  const [editing, setEditing] = useState<CharacterProfile>(profiles[0])
  const [saved, setSaved] = useState(false)
  const update = (patch: Partial<CharacterProfile>) => {
    setSaved(false)
    setEditing((current) => ({ ...current, ...patch }))
  }
  const save = () => {
    saveCharacterProfile(editing)
    setProfiles(listCharacterProfiles())
    setSaved(true)
  }
  const create = () => {
    setSaved(false)
    setEditing({
      id: `character-${Date.now()}`,
      name: String(t('新角色')),
      avatar: '/live2d/yachiyo/avatar.png',
      prompt: '',
      live2dModelId: '',
      defaultTtsProvider: 'bing',
      defaultTtsModel: 'edge-read-aloud',
    })
  }
  return (
    <SettingsPage
      title={t('角色设定')}
      description={t('人格、头像、Live2D 与默认模型')}
      actions={
        <Button variant="light" onClick={create}>
          {t('新建角色')}
        </Button>
      }
    >
      <div className="yachiyo-character-cards">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            data-selected={profile.id === editing.id}
            aria-pressed={profile.id === editing.id}
            onClick={() => {
              setEditing(profile)
              setSaved(false)
            }}
          >
            <img src={profile.avatar} alt="" />
            <span>
              <strong>{profile.name}</strong>
              <small>{profile.defaultLlmModel || t('跟随对话模型')}</small>
            </span>
          </button>
        ))}
      </div>
      <SettingsSection title={t('角色资料')}>
        <TextInput label={t('名称')} value={editing.name} onChange={(e) => update({ name: e.currentTarget.value })} />
        <TextInput
          label={t('头像地址或 data URL')}
          value={editing.avatar}
          onChange={(e) => update({ avatar: e.currentTarget.value })}
        />
      </SettingsSection>
      <SettingsSection title={t('角色提示词')}>
        <Textarea
          aria-label={String(t('角色提示词'))}
          minRows={8}
          autosize
          value={editing.prompt}
          onChange={(e) => update({ prompt: e.currentTarget.value })}
        />
      </SettingsSection>
      <SettingsSection title={t('模型与声音')}>
        <TextInput
          label={t('Live2D 模型 ID')}
          value={editing.live2dModelId}
          onChange={(e) => update({ live2dModelId: e.currentTarget.value })}
        />
        <TextInput
          label={t('默认 LLM 模型')}
          value={editing.defaultLlmModel || ''}
          onChange={(e) => update({ defaultLlmModel: e.currentTarget.value })}
        />
        <Select
          label={t('默认 TTS')}
          value={editing.defaultTtsProvider}
          data={[
            { value: 'bing', label: String(t('Bing 免费语音')) },
            { value: 'android-system', label: String(t('Android 系统 TTS')) },
            { value: 'openai-compatible', label: String(t('OpenAI 兼容 TTS')) },
          ]}
          onChange={(value) => value && update({ defaultTtsProvider: value as CharacterProfile['defaultTtsProvider'] })}
        />
        <TextInput
          label={t('默认 TTS 模型/音色')}
          value={editing.defaultTtsModel}
          onChange={(e) => update({ defaultTtsModel: e.currentTarget.value })}
        />
      </SettingsSection>
      <SettingsActions>
        <Button onClick={save} disabled={!editing.name.trim()}>
          {t('保存角色')}
        </Button>
        {saved && (
          <Text role="status" c="green">
            {t('角色已保存')}
          </Text>
        )}
      </SettingsActions>
    </SettingsPage>
  )
}
