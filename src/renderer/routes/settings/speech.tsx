import { SettingsActions, SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { Button, PasswordInput, Select, Text, Textarea, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function SpeechSettingsPage() {
  const { t } = useTranslation()
  const [value, setValue] = useState(getSpeechSettings)
  const [credentials, setCredentials] = useState<SpeechCredentials>({
    asrApiKey: '',
    ttsApiKey: '',
    asrHeaders: '',
    ttsHeaders: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [credentialsState, setCredentialsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const patch = (next: Partial<SpeechSettings>) => {
    setSaved(false)
    setValue((current) => ({ ...current, ...next }))
  }

  useEffect(() => {
    let active = true
    setCredentialsState('loading')
    setError('')
    void getSpeechCredentials()
      .then((stored) => {
        if (!active) return
        // Versions before 0.0.11 stored custom headers in plaintext settings. Keep them visible until
        // the next save, which moves them into the context-bound Keystore envelope.
        setCredentials({
          ...stored,
          asrHeaders: stored.asrHeaders || value.asrHeaders,
          ttsHeaders: stored.ttsHeaders || value.ttsHeaders,
        })
        setCredentialsState('ready')
      })
      .catch((cause) => {
        if (!active) return
        setCredentialsState('error')
        setError(cause instanceof Error ? cause.message : String(t('无法读取语音配置')))
      })
    return () => {
      active = false
    }
  }, [loadAttempt])

  const patchCredentials = (next: Partial<SpeechCredentials>) => {
    setSaved(false)
    setCredentials((current) => ({ ...current, ...next }))
  }

  const changeAsrProvider = (provider: ASRProvider) => {
    const defaults = getSpeechProviderDefaults(provider, 'asr')
    patch({ asrProvider: provider, asrBaseUrl: defaults.baseUrl, asrModel: defaults.model })
  }

  const changeTtsProvider = (provider: TTSProvider) => {
    const defaults = getSpeechProviderDefaults(provider, 'tts')
    patch({ ttsProvider: provider, ttsBaseUrl: defaults.baseUrl, ttsModel: defaults.model })
  }

  const save = async () => {
    if (credentialsState !== 'ready' || saving) return
    setSaving(true)
    setSaved(false)
    try {
      await saveSpeechCredentials(credentials)
      saveSpeechSettings(value)
      setSaved(true)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(t('语音设置保存失败')))
    } finally {
      setSaving(false)
    }
  }

  const remoteAsr = value.asrProvider !== 'yachiyo-offline' && value.asrProvider !== 'android-system'
  const remoteTts = value.ttsProvider !== 'bing' && value.ttsProvider !== 'android-system'

  return (
    <SettingsPage title={t('语音服务')} description={t('识别你的声音，选择角色的音色')}>
      <SettingsSection title={t('语音识别（ASR）')}>
        <Select
          label={t('ASR 提供商')}
          value={value.asrProvider}
          allowDeselect={false}
          data={ASR_PROVIDERS.map((provider) => ({ ...provider, label: String(t(provider.label)) }))}
          onChange={(provider) => provider && changeAsrProvider(provider as ASRProvider)}
        />
        {value.asrProvider === 'yachiyo-offline' && (
          <Text size="sm" c="dimmed">
            {t('模型随应用安装，不依赖 Google 服务，也无需额外下载。')}
          </Text>
        )}
        {remoteAsr && (
          <>
            <TextInput
              label={t('ASR API 地址')}
              value={value.asrBaseUrl}
              placeholder="https://example.com/v1"
              onChange={(event) => patch({ asrBaseUrl: event.currentTarget.value })}
            />
            <PasswordInput
              label={t('ASR API Key')}
              value={credentials.asrApiKey}
              disabled={credentialsState !== 'ready' || saving}
              onChange={(event) => patchCredentials({ asrApiKey: event.currentTarget.value })}
            />
            <TextInput
              label={t('ASR 模型')}
              value={value.asrModel}
              onChange={(event) => patch({ asrModel: event.currentTarget.value })}
            />
            <Textarea
              label={t('ASR 附加请求头（JSON，可选）')}
              value={credentials.asrHeaders}
              disabled={credentialsState !== 'ready' || saving}
              autosize
              minRows={2}
              onChange={(event) => patchCredentials({ asrHeaders: event.currentTarget.value })}
            />
          </>
        )}
        <TextInput
          label={t('识别语言')}
          value={value.language}
          onChange={(event) => patch({ language: event.currentTarget.value })}
        />
      </SettingsSection>
      <SettingsSection title={t('语音合成（TTS）')}>
        <Select
          label={t('TTS 提供商')}
          value={value.ttsProvider}
          allowDeselect={false}
          data={TTS_PROVIDERS.map((provider) => ({ ...provider, label: String(t(provider.label)) }))}
          onChange={(provider) => provider && changeTtsProvider(provider as TTSProvider)}
        />
        {remoteTts && (
          <>
            <TextInput
              label={t('TTS API 地址')}
              value={value.ttsBaseUrl}
              placeholder="https://example.com/v1"
              onChange={(event) => patch({ ttsBaseUrl: event.currentTarget.value })}
            />
            <PasswordInput
              label={t('TTS API Key（可选）')}
              value={credentials.ttsApiKey}
              disabled={credentialsState !== 'ready' || saving}
              onChange={(event) => patchCredentials({ ttsApiKey: event.currentTarget.value })}
            />
            <Textarea
              label={t('TTS 附加请求头（JSON，可选）')}
              value={credentials.ttsHeaders}
              disabled={credentialsState !== 'ready' || saving}
              autosize
              minRows={2}
              onChange={(event) => patchCredentials({ ttsHeaders: event.currentTarget.value })}
            />
          </>
        )}
        {value.ttsProvider !== 'bing' && value.ttsProvider !== 'android-system' && (
          <TextInput
            label={t('TTS 模型')}
            value={value.ttsModel}
            onChange={(event) => patch({ ttsModel: event.currentTarget.value })}
          />
        )}
        <TextInput
          label={value.ttsProvider === 'gpt-sovits' ? t('参考音频路径') : t('音色')}
          value={value.voice}
          onChange={(event) => patch({ voice: event.currentTarget.value })}
        />
      </SettingsSection>
      <SettingsActions>
        {credentialsState === 'loading' && (
          <Text role="status" size="sm">
            {t('正在读取语音配置…')}
          </Text>
        )}
        {credentialsState === 'error' && (
          <Button variant="light" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            {t('重试')}
          </Button>
        )}
        <Button loading={saving} disabled={credentialsState !== 'ready'} onClick={() => void save()}>
          {t('保存语音设置')}
        </Button>
        {saved && (
          <Text size="sm" c="green" role="status">
            {t('语音设置已保存')}
          </Text>
        )}
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
      </SettingsActions>
    </SettingsPage>
  )
}
