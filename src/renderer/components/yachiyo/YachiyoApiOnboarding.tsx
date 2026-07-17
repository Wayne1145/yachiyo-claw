import { Button, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { ApiError } from '@shared/models/errors'
import { IconArrowRight, IconKey, IconLock, IconServer } from '@tabler/icons-react'
import { type FormEvent, useId, useState } from 'react'
import { YACHIYO_API_BASE_URL, YACHIYO_DEFAULT_MODEL_ID } from '@/mobile/android-app-shell'
import { YachiyoMark } from './YachiyoMark'

export function YachiyoApiOnboarding({
  onSubmit,
  onOpenProviders,
}: {
  onSubmit: (apiKey: string) => Promise<void> | void
  onOpenProviders: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!apiKey.trim()) {
      setError('请输入 API Key')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(apiKey)
      setApiKey('')
    } catch (submitError) {
      if (submitError instanceof ApiError && (submitError.statusCode === 401 || submitError.statusCode === 403)) {
        setError('API Key 无效或无权访问，请检查后重试')
      } else if (submitError instanceof Error && submitError.message === 'settings_persist_failed') {
        setError('密钥验证成功，但安全保存失败，请重试')
      } else if (submitError instanceof Error && submitError.message === 'yachiyo_default_model_unavailable') {
        setError('服务可达，但默认模型 gpt-5.6 当前不可用')
      } else {
        setError('无法连接 Yachiyo API，请检查网络后重试')
      }
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
                连接 Yachiyo API
              </Title>
            </div>
          </div>

          <div className="yachiyo-endpoint-summary" aria-label="默认连接信息">
            <div>
              <IconServer size={18} aria-hidden="true" />
              <span>服务</span>
              <strong>{YACHIYO_API_BASE_URL.replace('https://', '')}</strong>
            </div>
            <div>
              <IconKey size={18} aria-hidden="true" />
              <span>模型</span>
              <strong>{YACHIYO_DEFAULT_MODEL_ID}</strong>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <PasswordInput
                label="API Key"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.currentTarget.value)
                  if (error) setError(null)
                }}
                placeholder="sk-..."
                autoComplete="off"
                leftSection={<IconKey size={18} aria-hidden="true" />}
                error={error}
                size="md"
              />
              <Button
                type="submit"
                size="md"
                loading={submitting}
                rightSection={<IconArrowRight size={18} aria-hidden="true" />}
                className="yachiyo-primary-button"
              >
                保存并开始
              </Button>
            </Stack>
          </form>

          <div className="yachiyo-local-security-note">
            <IconLock size={18} aria-hidden="true" />
            <Text size="sm">密钥由 Android Keystore 加密，仅保存在此设备。</Text>
          </div>

          <Button variant="subtle" color="gray" onClick={onOpenProviders}>
            使用其他 API 服务
          </Button>
        </Stack>
      </section>
    </main>
  )
}
