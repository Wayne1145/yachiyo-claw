import { Text, Title } from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import { IconCircleCheckFilled } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { YachiyoMark } from './YachiyoMark'

export function YachiyoChatLanding() {
  const { t } = useTranslation()
  const defaultModel = useSettingsStore((state) => state.defaultChatModel)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providerName = defaultModel
    ? [...SystemProviders(), ...(customProviders || [])].find((provider) => provider.id === defaultModel.provider)
        ?.name || defaultModel.provider
    : undefined

  return (
    <div className="yachiyo-chat-landing">
      <YachiyoMark size={52} />
      <div>
        <Title order={1}>Yachiyo Claw</Title>
        <Text c="dimmed">{t('今天想聊些什么？')}</Text>
      </div>
      {defaultModel && (
        <div className="yachiyo-model-status">
          <IconCircleCheckFilled size={16} aria-hidden="true" />
          <span>{t(providerName || defaultModel.provider)}</span>
          <span aria-hidden="true">·</span>
          <span>{defaultModel.model}</span>
        </div>
      )}
    </div>
  )
}
