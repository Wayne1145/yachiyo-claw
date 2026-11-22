import type { ReactNode } from 'react'
import { SettingsNavigation } from '@/components/settings/SettingsNavigation'
import { useAndroidShellLayout } from './android-landscape-layout'
import { ThemeCenter } from './ThemeCenter'
import './android-settings-panes.css'

export function AndroidSettingsPanes({ children, home }: { children: ReactNode; home: boolean }) {
  const wide = useAndroidShellLayout() === 'wide'
  return (
    <div className="yachiyo-settings-panes" data-split={wide || undefined}>
      {wide && (
        <aside className="yachiyo-settings-catalog">
          <SettingsNavigation compact selectedRoute={home ? '/settings/themes' : undefined} />
        </aside>
      )}
      <div className="yachiyo-settings-pane-content">{children}</div>
    </div>
  )
}

export function AndroidSettingsHome() {
  const wide = useAndroidShellLayout() === 'wide'
  if (wide)
    return (
      <div className="yachiyo-settings-detail settings-surface">
        <ThemeCenter />
      </div>
    )
  return (
    <main className="yachiyo-settings-home settings-home-host">
      <SettingsNavigation />
    </main>
  )
}
