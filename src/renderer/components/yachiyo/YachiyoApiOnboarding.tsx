import { Button, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { IconArrowRight, IconKey, IconLock, IconServer } from '@tabler/icons-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { YACHIYO_API_BASE_URL } from '@/mobile/android-app-shell'
import { YachiyoMark } from './YachiyoMark'

type OnboardingError = 'missing-key' | 'persist-failed'

export function YachiyoApiOnboarding({
  onSubmit,
  onOpenProviders,
}: {
  onSubmit: (apiKey: string) => Promise<void> | void
  onOpenProviders: () => void
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<OnboardingError | null>(null)
  const titleId = useId()
  const errorMessage =
    error === 'missing-key'
      ? t('请输入 API Key')
      : error === 'persist-failed'
        ? t('API Key 安全保存失败，请重试')
        : null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!apiKey.trim()) {
      setError('missing-key')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(apiKey)
      setApiKey('')
    } catch {
      setError('persist-failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="yachiyo-onboarding" aria-labelledby={titleId}>
      <section className="yachiyo-onboarding-panel">
        <Stack gap="lg">
          <div className="yachiyo-onboarding-brand">
            <YachiyoMark size={64} />
            <div>
              <Text className="yachiyo-eyebrow">YACHIYO CLAW</Text>
              <Title id={titleId} order={1} className="yachiyo-onboarding-title">
                {t('连接 Yachiyo API')}
              </Title>
            </div>
          </div>

          <div className="yachiyo-endpoint-summary" aria-label={String(t('默认连接信息'))}>
            <div>
              <IconServer size={18} aria-hidden="true" />
              <span>{t('服务')}</span>
              <strong>{YACHIYO_API_BASE_URL.replace('https://', '')}</strong>
            </div>
            <div>
              <IconKey size={18} aria-hidden="true" />
              <span>{t('模型')}</span>
              <strong>{t('保存后自动获取模型列表')}</strong>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <PasswordInput
                label={t('API Key')}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.currentTarget.value)
                  if (error) setError(null)
                }}
                placeholder="sk-..."
                autoComplete="off"
                leftSection={<IconKey size={18} aria-hidden="true" />}
                error={errorMessage}
                size="md"
              />
              <Button
                type="submit"
                size="md"
                loading={submitting}
                rightSection={<IconArrowRight size={18} aria-hidden="true" />}
                className="yachiyo-primary-button"
              >
                {t('保存并开始')}
              </Button>
            </Stack>
          </form>

          <div className="yachiyo-local-security-note">
            <IconLock size={18} aria-hidden="true" />
            <Text size="sm">{t('密钥由 Android Keystore 加密，仅保存在此设备。')}</Text>
          </div>

          <Button variant="subtle" color="gray" onClick={onOpenProviders}>
            {t('使用其他 API 服务')}
          </Button>
        </Stack>
      </section>
    </main>
  )
}
