import { useMemo } from 'react'
import { getAndroidShellTabs, type AndroidShellTab } from '@/mobile/android-app-shell'
import { useSettingsStore } from '@/stores/settingsStore'

export function AndroidBottomNavigation({
  activeTab,
  onChange,
  items: providedItems,
}: {
  activeTab: AndroidShellTab
  onChange: (tab: AndroidShellTab) => void
  items?: ReturnType<typeof getAndroidShellTabs>
}) {
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const defaultItems = useMemo(() => getAndroidShellTabs(overrides), [overrides])
  const items = providedItems ?? defaultItems
  return (
    <nav className="yachiyo-bottom-nav" aria-label="主导航">
      <div className="yachiyo-bottom-nav-grid">
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
              onClick={() => onChange(item.id)}
            >
              <Icon size={22} stroke={active ? 2.2 : 1.7} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
