import { Button, PasswordInput, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getSpeechCredentials, saveSpeechCredentials, type SpeechCredentials } from '@/mobile/speech-credentials'
import {
  type ASRProvider,
  getSpeechProviderDefaults,
  getSpeechSettings,
  saveSpeechSettings,
  type SpeechSettings,
  type TTSProvider,
} from '@/mobile/speech-settings'

export const Route = createFileRoute('/settings/speech')({ component: SpeechSettingsPage })

const ASR_PROVIDERS = [
  { value: 'yachiyo-offline', label: 'Yachiyo 内置离线识别（中英）' },
  { value: 'android-system', label: 'Android 系统语音识别' },
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'aliyun', label: '阿里云 / DashScope' },
  { value: 'volcengine', label: '火山引擎 / Ark' },
  { value: 'custom', label: '自定义 HTTP API' },
]

const TTS_PROVIDERS = [
  { value: 'bing', label: 'Bing Edge 免费语音' },
  { value: 'android-system', label: 'Android 系统 TTS' },
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'aliyun', label: '阿里云 / DashScope' },
  { value: 'volcengine', label: '火山引擎 / Ark' },
  { value: 'gpt-sovits', label: 'GPT-SoVITS' },
  { value: 'custom', label: '自定义 HTTP API' },
]

function SpeechSettingsPage() {
  const [value, setValue] = useState(getSpeechSettings)
  const [credentials, setCredentials] = useState<SpeechCredentials>({ asrApiKey: '', ttsApiKey: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const patch = (next: Partial<SpeechSettings>) => setValue((current) => ({ ...current, ...next }))

  useEffect(() => {
    void getSpeechCredentials().then(setCredentials)
  }, [])

  const changeAsrProvider = (provider: ASRProvider) => {
    const defaults = getSpeechProviderDefaults(provider, 'asr')
    patch({ asrProvider: provider, asrBaseUrl: defaults.baseUrl, asrModel: defaults.model })
  }

  const changeTtsProvider = (provider: TTSProvider) => {
    const defaults = getSpeechProviderDefaults(provider, 'tts')
    patch({ ttsProvider: provider, ttsBaseUrl: defaults.baseUrl, ttsModel: defaults.model })
  }

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await saveSpeechCredentials(credentials)
      saveSpeechSettings(value)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const remoteAsr = value.asrProvider !== 'yachiyo-offline' && value.asrProvider !== 'android-system'
  const remoteTts = value.ttsProvider !== 'bing' && value.ttsProvider !== 'android-system'

  return (
    <main className="yachiyo-character-settings">
      <Title order={1}>语音服务</Title>
      <Text c="dimmed" mb="md">
        ASR 与 TTS 独立配置。API Key 在 Android 上由系统 Keystore 加密保存。
      </Text>
      <section className="yachiyo-character-editor">
        <Title order={2}>语音识别（ASR）</Title>
        <Select
          label="ASR 提供商"
          value={value.asrProvider}
          allowDeselect={false}
          data={ASR_PROVIDERS}
          onChange={(provider) => provider && changeAsrProvider(provider as ASRProvider)}
        />
        {value.asrProvider === 'yachiyo-offline' && (
          <Text size="sm" c="dimmed">
            模型随应用安装，不依赖 Google 服务，也无需额外下载。
          </Text>
        )}
        {remoteAsr && (
          <>
            <TextInput
              label="ASR API 地址"
              value={value.asrBaseUrl}
              placeholder="https://example.com/v1"
              onChange={(event) => patch({ asrBaseUrl: event.currentTarget.value })}
            />
            <PasswordInput
              label="ASR API Key"
              value={credentials.asrApiKey}
              onChange={(event) => setCredentials((current) => ({ ...current, asrApiKey: event.currentTarget.value }))}
            />
            <TextInput label="ASR 模型" value={value.asrModel} onChange={(event) => patch({ asrModel: event.currentTarget.value })} />
            <Textarea
              label="ASR 附加请求头（JSON，可选）"
              value={value.asrHeaders}
              autosize
              minRows={2}
              onChange={(event) => patch({ asrHeaders: event.currentTarget.value })}
            />
          </>
        )}
        <TextInput label="识别语言" value={value.language} onChange={(event) => patch({ language: event.currentTarget.value })} />

        <Title order={2}>语音合成（TTS）</Title>
        <Select
          label="TTS 提供商"
          value={value.ttsProvider}
          allowDeselect={false}
          data={TTS_PROVIDERS}
          onChange={(provider) => provider && changeTtsProvider(provider as TTSProvider)}
        />
        {remoteTts && (
          <>
            <TextInput
              label="TTS API 地址"
              value={value.ttsBaseUrl}
              placeholder="https://example.com/v1"
              onChange={(event) => patch({ ttsBaseUrl: event.currentTarget.value })}
            />
            <PasswordInput
              label="TTS API Key（可选）"
              value={credentials.ttsApiKey}
              onChange={(event) => setCredentials((current) => ({ ...current, ttsApiKey: event.currentTarget.value }))}
            />
            <Textarea
              label="TTS 附加请求头（JSON，可选）"
              value={value.ttsHeaders}
              autosize
              minRows={2}
              onChange={(event) => patch({ ttsHeaders: event.currentTarget.value })}
            />
          </>
        )}
        {value.ttsProvider !== 'bing' && value.ttsProvider !== 'android-system' && (
          <TextInput label="TTS 模型" value={value.ttsModel} onChange={(event) => patch({ ttsModel: event.currentTarget.value })} />
        )}
        <TextInput
          label={value.ttsProvider === 'gpt-sovits' ? '参考音频路径' : '音色'}
          value={value.voice}
          onChange={(event) => patch({ voice: event.currentTarget.value })}
        />
        <Stack gap="xs">
          <Button loading={saving} onClick={() => void save()}>
            保存语音设置
          </Button>
          {saved && <Text size="sm" c="green">语音设置已保存</Text>}
        </Stack>
      </section>
    </main>
  )
}
