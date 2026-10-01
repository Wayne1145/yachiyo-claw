import { IconChevronRight, IconPuzzle, IconSearch, IconX } from '@tabler/icons-react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { registerBuiltinFeatureUi } from '@/features/builtin-feature-ui'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { getEnabledFeatureIds, resolveRendererFeaturePlatform } from '@/features/feature-runtime'
import { getSettingsEntries } from '@/features/ui-registry'
import { usePluginStore } from '@/plugins/plugin-manager'
import { useSettingsStore } from '@/stores/settingsStore'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useAndroidRetainedState } from '@/components/yachiyo/android-retained-state'
import {
  CORE_SETTINGS,
  DEVELOPER_SETTINGS,
  filterSettings,
  HOTKEY_SETTINGS,
  SETTINGS_GROUPS,
  settingsGroup,
  type SettingsEntry,
} from './settings-catalog'
import './settings.css'

export function SettingsNavigation({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [query, setQuery] = useAndroidRetainedState(`settings-search:${compact ? 'sidebar' : 'home'}`, '')
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const inAndroidAppShell = useInAndroidAppShell()
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const plugins = usePluginStore((state) => state.installed)
  const contributionPluginIds = usePluginStore((state) => state.contributionPluginIds)
  const entries = useMemo(() => {
    registerBuiltinFeatures()
    registerBuiltinFeatureUi()
    const platform = inAndroidAppShell ? 'android' : resolveRendererFeaturePlatform()
    const enabledFeatureIds = getEnabledFeatureIds(platform, overrides)
    const contributed = (['model', 'capability', 'app'] as const).flatMap((group) =>
      getSettingsEntries(group, { platform, enabledFeatureIds }).map((entry) => ({ ...entry, group }))
    )
    const allowed = new Set(contributionPluginIds)
    const pluginEntries = (enabledFeatureIds.has('plugins') ? plugins : [])
      .filter((record) => allowed.has(record.manifest.id))
      .flatMap((record) => record.manifest.contributions.settingsEntries ?? [])
      .map((entry) => ({ ...entry, icon: IconPuzzle }))
    const all: SettingsEntry[] = [
      ...CORE_SETTINGS,
      ...contributed,
      ...pluginEntries,
      ...(platform === 'android' ? [] : [HOTKEY_SETTINGS]),
      ...(process.env.NODE_ENV === 'development' ? [DEVELOPER_SETTINGS] : []),
    ]
    return all.map((entry) => ({ ...entry, group: settingsGroup(entry) })).sort((a, b) => a.order - b.order)
  }, [inAndroidAppShell, overrides, plugins, contributionPluginIds])
  const visible = filterSettings(entries, query, (key) => String(t(key)))

  return (
    <div
      className={`settings-surface settings-navigation ${compact ? 'settings-navigation-compact' : 'settings-home'}`}
    >
      <header className="settings-page-heading">
        <div>
          <h1>{t('设置')}</h1>
          {!compact && <p>{t('让 Yachiyo 更适合你')}</p>}
        </div>
      </header>
      <div className="settings-search">
        <IconSearch size={19} aria-hidden="true" />
        <input
          type="search"
          aria-label={String(t('搜索设置'))}
          placeholder={String(t('搜索设置'))}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button type="button" aria-label={String(t('清除搜索'))} onClick={() => setQuery('')}>
            <IconX size={17} />
          </button>
        )}
      </div>
      <nav aria-label={String(t('设置分类'))} className="settings-navigation-groups">
        {SETTINGS_GROUPS.map((group) => {
          const items = visible.filter((entry) => entry.group === group.id)
          if (!items.length) return null
          return (
            <section
              key={group.id}
              className="settings-nav-group"
              aria-label={String(t(group.title))}
              data-group={group.id}
            >
              <h2>{t(group.title)}</h2>
              <div className="settings-nav-list">
                {items.map((item) => {
                  const Icon = item.icon
                  const active =
                    pathname === item.route ||
                    (item.route === '/settings/provider' &&
                      pathname.startsWith('/settings/provider/') &&
                      pathname !== '/settings/provider/yachiyo')
                  return (
                    <Link
                      key={item.route}
                      to={item.route as '/settings'}
                      className="settings-nav-row"
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className="settings-nav-icon" aria-hidden="true">
                        <Icon size={21} stroke={1.75} />
                      </span>
                      <span className="settings-nav-copy">
                        <strong>{t(item.label)}</strong>
                        {!compact && <small>{t(item.detail)}</small>}
                      </span>
                      <IconChevronRight size={17} className="settings-nav-chevron" aria-hidden="true" />
                    </Link>
                  )
                })}
              </div>
            </section>
          )
        })}
      </nav>
      {visible.length === 0 && (
        <div className="settings-empty" role="status">
          <IconSearch size={28} aria-hidden="true" />
          <strong>{t('没有找到相关设置')}</strong>
          <p>{t('试试模型、主题、语音或备份')}</p>
        </div>
      )}
      {!compact && <p className="settings-home-footer">Yachiyo Claw</p>}
    </div>
  )
}
