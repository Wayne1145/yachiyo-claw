import { Button, Text } from '@mantine/core'
import { ModelProviderEnum, type ProviderBaseInfo } from '@shared/types'
import { IconChevronRight, IconPlus } from '@tabler/icons-react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { FEATURED_PROVIDER_IDS, ProviderIconImage } from './providerIcons'

interface ProviderListProps {
  providers: ProviderBaseInfo[]
  onAddProvider: () => void
}

export function ProviderList({ providers, onAddProvider }: ProviderListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const isSmallScreen = useIsSmallScreen()
  const inAndroidAppShell = useInAndroidAppShell()
  const useSingleColumnLayout = isSmallScreen || inAndroidAppShell
  const routerState = useRouterState()

  const providerId = useMemo(() => {
    const pathSegments = routerState.location.pathname.split('/').filter(Boolean)
    const providerIndex = pathSegments.indexOf('provider')
    return providerIndex !== -1 ? pathSegments[providerIndex + 1] : undefined
  }, [routerState.location.pathname])

  const { providers: availableProviders } = useProviders()

  const activatedProviderIds = useMemo(() => new Set(availableProviders.map((p) => p.id)), [availableProviders])

  // Yachiyo is the product service. Chatbox AI is filtered before this list.
  const sortedProviders = useMemo(() => {
    const yachiyo = providers.filter((p) => p.id === ModelProviderEnum.Yachiyo)
    const activated: ProviderBaseInfo[] = []
    const featured: ProviderBaseInfo[] = []

    for (const p of providers) {
      if (p.id === ModelProviderEnum.Yachiyo) continue

      if (activatedProviderIds.has(p.id) || p.isCustom) {
        activated.push(p)
      } else if (FEATURED_PROVIDER_IDS.includes(p.id)) {
        featured.push(p)
      }
    }

    return [...yachiyo, ...activated, ...featured]
  }, [providers, activatedProviderIds])

  const visible = (query.trim() ? providers : sortedProviders).filter((provider) =>
    `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  return (
    <div className="settings-provider-list settings-surface" data-single={useSingleColumnLayout}>
      <header className="settings-page-heading">
        <div>
          <h1>{t('Model Provider')}</h1>
          <p>{t('选择服务商，配置连接与模型')}</p>
        </div>
      </header>
      <div className="settings-search">
        <input
          type="search"
          value={query}
          placeholder={String(t('搜索服务商'))}
          aria-label={String(t('搜索服务商'))}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <nav className="settings-nav-list" aria-label={String(t('Model Provider'))}>
        {visible.map((provider) => (
          <Link
            key={provider.id}
            to="/settings/provider/$providerId"
            params={{ providerId: provider.id }}
            className="settings-nav-row"
            aria-current={provider.id === providerId ? 'page' : undefined}
          >
            <span className="settings-nav-icon">
              <ProviderIconImage providerId={provider.id} size={24} />
            </span>
            <span className="settings-nav-copy">
              <strong>{provider.name}</strong>
              <small>{activatedProviderIds.has(provider.id) ? t('已配置') : t('未配置')}</small>
            </span>
            <IconChevronRight size={18} className="settings-nav-chevron" aria-hidden="true" />
          </Link>
        ))}
      </nav>
      {visible.length === 0 && (
        <Text className="settings-empty" role="status">
          {t('没有找到相关设置')}
        </Text>
      )}
      <div className="settings-actions">
        <Button variant="light" leftSection={<IconPlus size={18} />} onClick={onAddProvider}>
          {t('Add')}
        </Button>
      </div>
    </div>
  )
}
