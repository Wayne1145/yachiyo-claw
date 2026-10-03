import { Slider, Text } from '@mantine/core'
import { useState } from 'react'
import { Theme } from '@shared/types'
import { IconDeviceMobile, IconMoon, IconSun } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingsSection } from './SettingsPage'

export function AppearanceSettings() {
  const { t } = useTranslation()
  const theme = useSettingsStore((state) => state.theme)
  const fontSize = useSettingsStore((state) => state.fontSize)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [fontPreview, setFontPreview] = useState<number>()
  const displayedFont = fontPreview ?? fontSize
  return (
    <SettingsSection title={t('Display Settings')}>
      <div className="settings-appearance-options" role="group" aria-label={String(t('Theme'))}>
        {[
          { value: Theme.System, label: 'Follow System', icon: IconDeviceMobile },
          { value: Theme.Light, label: 'Light Mode', icon: IconSun },
          { value: Theme.Dark, label: 'Dark Mode', icon: IconMoon },
        ].map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className="settings-appearance-option"
            aria-pressed={theme === value}
            onClick={() => setSettings({ theme: value })}
          >
            <Icon size={24} stroke={1.6} aria-hidden="true" />
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      <div>
        <Text size="sm" fw={600}>
          {t('Font Size')} · {displayedFont}
        </Text>
        <Slider
          min={10}
          max={22}
          step={1}
          value={displayedFont}
          onChange={setFontPreview}
          onChangeEnd={(value) => {
            setSettings({ fontSize: value })
            setFontPreview(undefined)
          }}
          thumbLabel={String(t('Font Size'))}
        />
        <div className="settings-font-preview" style={{ fontSize: displayedFont }}>
          {t('让 Yachiyo 更适合你')}
        </div>
      </div>
    </SettingsSection>
  )
}
