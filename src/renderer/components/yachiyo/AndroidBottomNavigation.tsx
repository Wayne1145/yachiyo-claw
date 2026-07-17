import { IconListCheck, IconMessageCircle, IconSettings, IconSparkles } from '@tabler/icons-react'
import type { AndroidShellTab } from '@/mobile/android-app-shell'

const ITEMS = [
  { id: 'chat', label: '聊天', icon: IconMessageCircle },
  { id: 'interactive', label: '交互式', icon: IconSparkles },
  { id: 'tasks', label: '任务', icon: IconListCheck },
  { id: 'settings', label: '设置', icon: IconSettings },
] as const

export function AndroidBottomNavigation({
  activeTab,
  onChange,
}: {
  activeTab: AndroidShellTab
  onChange: (tab: AndroidShellTab) => void
}) {
  return (
    <nav className="yachiyo-bottom-nav" aria-label="主导航">
      <div className="yachiyo-bottom-nav-grid">
        {ITEMS.map((item) => {
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
