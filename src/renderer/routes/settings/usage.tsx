import { Button, Group, SimpleGrid, Text, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { Capacitor } from '@capacitor/core'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { Sub2ApiBillingCard } from '@/components/settings/Sub2ApiBillingCard'
import { useProviders } from '@/hooks/useProviders'
import { aggregateUsage, readUsageEntries, USAGE_CHANGED } from '@/mobile/usage-statistics'
import { yachiyoUsageNative } from '@/platform/native/yachiyo_usage'
import { YACHIYO_API_HOST } from '@shared/providers/definitions/yachiyo'

export const Route = createFileRoute('/settings/usage')({ component: UsagePage })
const dateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function UsagePage() {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [entries, setEntries] = useState(readUsageEntries)
  const [nativeEntries, setNativeEntries] = useState<ReturnType<typeof readUsageEntries>>([])
  const [start, setStart] = useState(() => dateValue(new Date(Date.now() - 6 * 86400000)))
  const [end, setEnd] = useState(() => dateValue(new Date()))
  useEffect(() => {
    const refresh = () => setEntries(readUsageEntries())
    window.addEventListener(USAGE_CHANGED, refresh)
    if (Capacitor.isNativePlatform())
      void yachiyoUsageNative
        .readEntries()
        .then((result) => setNativeEntries(result.entries))
        .catch(() => undefined)
    return () => window.removeEventListener(USAGE_CHANGED, refresh)
  }, [])
  const stats = useMemo(() => {
    const until = new Date(`${end}T00:00:00`)
    until.setDate(until.getDate() + 1)
    return aggregateUsage(
      [...new Map([...nativeEntries, ...entries].map((entry) => [entry.id, entry])).values()],
      new Date(`${start}T00:00:00`).getTime(),
      until.getTime()
    )
  }, [entries, nativeEntries, start, end])
  const format = (value: number) => value.toLocaleString()
  return (
    <SettingsPage title={t('用量统计')} description={t('本机最近 90 天的模型用量，不保存消息内容或密钥。')}>
      <SettingsSection title={t('统计区间')}>
        <SimpleGrid cols={2}>
          <TextInput
            type="date"
            label={t('开始日期')}
            value={start}
            max={end}
            onChange={(e) => setStart(e.currentTarget.value)}
          />
          <TextInput
            type="date"
            label={t('结束日期')}
            value={end}
            min={start}
            onChange={(e) => setEnd(e.currentTarget.value)}
          />
        </SimpleGrid>
        <Group gap="xs">
          {[1, 7, 30, 90].map((days) => (
            <Button
              key={days}
              size="xs"
              variant="light"
              radius="xl"
              onClick={() => {
                setEnd(dateValue(new Date()))
                setStart(dateValue(new Date(Date.now() - (days - 1) * 86400000)))
              }}
            >
              {t('{{days}} 天', { days })}
            </Button>
          ))}
        </Group>
        <Text size="xl" fw={700}>
          {format(stats.total)}{' '}
          <Text component="span" size="sm" c="dimmed">
            tokens
          </Text>
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          {[
            [t('输入'), stats.input],
            [t('输出'), stats.output],
            [t('推理（输出子集）'), stats.reasoning],
            [t('缓存命中（输入子集）'), stats.cached],
          ].map(([label, count]) => (
            <div key={label}>
              <Text size="xs" c="dimmed">
                {label}
              </Text>
              <Text fw={600}>{format(Number(count))}</Text>
            </div>
          ))}
        </SimpleGrid>
        <Group gap="md" wrap="wrap">
          <Text size="sm">
            {t('缓存命中率')} · {stats.cacheKnown ? `${(stats.cacheRate * 100).toFixed(1)}%` : t('未提供')}
          </Text>
          <Text size="sm">
            {t('工具调用')} · {stats.toolCalls}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t('含工具调用轮次消耗')} · {format(stats.toolRoundTokens)} tokens.{' '}
          {t('工具轮次包含正常推理；上游通常不单独报告工具 schema 的 token。未返回 usage 的请求不计入。')}
        </Text>
        <Group>
          {stats.byMode.map((item) => (
            <Text size="sm" key={item.mode}>
              {t(item.mode === 'agent' ? 'Agent' : item.mode === 'realtime' ? '实时通话' : '聊天')} ·{' '}
              {format(item.total)}
            </Text>
          ))}
        </Group>
      </SettingsSection>
      <SettingsSection title={t('每日总消耗')}>
        {stats.daily.length ? (
          stats.daily.map(([day, total]) => (
            <Group key={day} justify="space-between">
              <Text size="sm">{day}</Text>
              <Text size="sm" fw={600}>
                {format(total)} tokens
              </Text>
            </Group>
          ))
        ) : (
          <Text c="dimmed" size="sm">
            {t('所选区间暂无已上报用量。统计从此版本开始记录。')}
          </Text>
        )}
      </SettingsSection>
      <SettingsSection title={t('上游账单')} description={t('仅向所选 API 的原地址查询，不上传到其他服务。')}>
        {providers
          .filter((p) => p.apiKey && (p.apiHost || p.defaultSettings?.apiHost))
          .map((p) => (
            <div key={p.id}>
              <Text fw={600}>{p.name}</Text>
              <Sub2ApiBillingCard
                host={p.id === 'yachiyo' ? YACHIYO_API_HOST : p.apiHost || p.defaultSettings?.apiHost}
                apiKey={p.apiKey}
                automatic={p.id === 'yachiyo'}
              />
            </div>
          ))}
      </SettingsSection>
    </SettingsPage>
  )
}
