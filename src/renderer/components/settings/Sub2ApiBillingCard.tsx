import { Button, Group, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSub2ApiBilling, type Sub2ApiBilling } from '@/mobile/sub2api-billing'

export function Sub2ApiBillingCard({
  host,
  apiKey,
  automatic = false,
}: {
  host?: string
  apiKey?: string
  automatic?: boolean
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<Sub2ApiBilling>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setValue(undefined)
    setError('')
    setLoading(false)
    if (!host || !apiKey || (!automatic && !attempt)) return
    setLoading(true)
    void fetchSub2ApiBilling(host, apiKey)
      .then((result) => {
        if (active) setValue(result)
      })
      .catch(() => {
        if (active) setError(String(t('上游未提供 sub2api 账单接口，或密钥无权访问')))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [host, apiKey, automatic, attempt, t])
  return (
    <div className="settings-billing-card">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Text size="sm" fw={600}>
          {t('sub2api 倍率与余额')}
        </Text>
        <Button
          size="xs"
          variant="light"
          radius="xl"
          loading={loading}
          disabled={!host || !apiKey}
          onClick={() => setAttempt((v) => v + 1)}
        >
          {t('刷新账单')}
        </Button>
      </Group>
      {value ? (
        <>
          <Text size="sm">
            {t('有效倍率')} · {value.multiplier === undefined ? t('未提供') : `${value.multiplier}×`}
          </Text>
          <Text size="sm">
            {t(
              value.scope === 'key-quota'
                ? '密钥剩余额度'
                : value.scope === 'subscription'
                  ? '订阅剩余额度'
                  : '账户余额'
            )}{' '}
            ·{' '}
            {value.balance !== undefined
              ? `$${value.balance.toFixed(4)}`
              : value.remaining !== undefined
                ? `$${value.remaining.toFixed(4)}`
                : t('未提供')}
          </Text>
          <Text size="xs" c="dimmed">
            {new Date(value.at).toLocaleString()}
          </Text>
        </>
      ) : (
        <Text size="xs" c={error ? 'red' : 'dimmed'}>
          {error || t('按上游返回的真实账单显示；不支持的接口不会被当作零余额。')}
        </Text>
      )}
    </div>
  )
}
