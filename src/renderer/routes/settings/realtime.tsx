import { Button, PasswordInput, Select, Switch, Text, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import {
  getRealtimeApiKey,
  getRealtimeSettings,
  REALTIME_DEFAULTS,
  saveRealtimeApiKey,
  saveRealtimeSettings,
  type RealtimeProtocol,
} from '@/mobile/realtime-settings'
import { realtimeEndpoint } from '@/mobile/realtime-protocol'

export const Route = createFileRoute('/settings/realtime')({ component: RealtimeSettingsPage })
function RealtimeSettingsPage() {
  const { t } = useTranslation()
  const [value, setValue] = useState(getRealtimeSettings)
  const [key, setKey] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    void getRealtimeApiKey()
      .then((stored) => {
        if (active) {
          setKey(stored)
          setReady(true)
        }
      })
      .catch(() => {
        if (active) setMessage(String(t('无法读取语音配置')))
      })
    return () => {
      active = false
    }
  }, [t])
  return (
    <SettingsPage
      title={t('实时语音 / 视频通话')}
      description={t('直接向模型发送音频并接收音频，不经过 ASR → 聊天 → TTS。')}
    >
      <SettingsSection title={t('Realtime API')}>
        <Select
          label={t('协议')}
          value={value.protocol}
          allowDeselect={false}
          data={[
            { value: 'openai', label: 'OpenAI Realtime (GA)' },
            { value: 'dashscope', label: 'DashScope / Qwen Omni Realtime' },
          ]}
          onChange={(protocol) => protocol && setValue({ ...REALTIME_DEFAULTS[protocol as RealtimeProtocol] })}
        />
        <TextInput
          label={t('WebSocket 地址')}
          value={value.endpoint}
          onChange={(e) => setValue({ ...value, endpoint: e.currentTarget.value })}
        />
        <PasswordInput label="API Key" value={key} disabled={!ready} onChange={(e) => setKey(e.currentTarget.value)} />
        <TextInput
          label={t('模型 ID')}
          value={value.model}
          onChange={(e) => setValue({ ...value, model: e.currentTarget.value })}
        />
        <TextInput
          label={t('音色')}
          value={value.voice}
          onChange={(e) => setValue({ ...value, voice: e.currentTarget.value })}
        />
        <Switch
          label={t('允许通话期间发送摄像头画面')}
          description={t('还需在交互页开启摄像头并确认发送。每秒最多一帧；关闭或离开页面即停止。')}
          checked={value.video}
          onChange={(e) => setValue({ ...value, video: e.currentTarget.checked })}
        />
        <Text size="xs" c="dimmed">
          {t(
            '模型名可按上游实际 ID 修改。模板不是可用性保证；需上游同时支持该协议、音频与图像。Android 使用 Keystore 加密密钥。'
          )}
        </Text>
        <Button
          disabled={!ready}
          loading={saving}
          radius="xl"
          onClick={async () => {
            setSaving(true)
            try {
              realtimeEndpoint(value)
              await saveRealtimeApiKey(key.trim())
              saveRealtimeSettings(value)
              setMessage(String(t('已保存')))
            } catch {
              setMessage(String(t('请检查 WSS 地址、模型 ID 和密钥配置')))
            } finally {
              setSaving(false)
            }
          }}
        >
          {t('保存')}
        </Button>
        {message && <Text size="sm">{message}</Text>}
      </SettingsSection>
    </SettingsPage>
  )
}
