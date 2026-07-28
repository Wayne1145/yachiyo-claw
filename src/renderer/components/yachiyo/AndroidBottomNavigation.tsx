import { type CSSProperties, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getAndroidShellTabs, type AndroidShellTab } from '@/mobile/android-app-shell'
import { useSettingsStore } from '@/stores/settingsStore'
import { flowGlassHaptics } from '@/utils/mobile-haptics'

type BottomNavigationStyle = CSSProperties & {
  '--yachiyo-tab-count': number
  '--yachiyo-active-tab': number
}

export function AndroidBottomNavigation({
  activeTab,
  onChange,
  items: providedItems,
}: {
  activeTab: AndroidShellTab
  onChange: (tab: AndroidShellTab) => void
  items?: ReturnType<typeof getAndroidShellTabs>
}) {
  const { t } = useTranslation()
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const defaultItems = useMemo(() => getAndroidShellTabs(overrides), [overrides])
  const items = providedItems ?? defaultItems
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeTab)
  )
  const style: BottomNavigationStyle = {
    '--yachiyo-tab-count': Math.max(1, items.length),
    '--yachiyo-active-tab': activeIndex,
  }
  return (
    <nav className="yachiyo-bottom-nav" aria-label={String(t('主导航'))}>
      <div className="yachiyo-bottom-nav-grid" style={style}>
        <span className="yachiyo-bottom-nav-lens" aria-hidden="true" />
        {items.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              className="yachiyo-bottom-nav-item"
              data-active={active ? 'true' : 'false'}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                void flowGlassHaptics.selection()
                onChange(item.id)
              }}
            >
              <Icon size={22} stroke={active ? 2.2 : 1.7} aria-hidden="true" />
              <span>{t(item.label)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
