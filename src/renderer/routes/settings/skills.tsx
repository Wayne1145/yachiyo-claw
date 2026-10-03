import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SkillsSection } from '@/components/settings/skills'

export const Route = createFileRoute('/settings/skills')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()

  return (
    <SettingsPage title={t('Skills')} description={t('Enabled skills will be available in Task mode.')}>
      <SettingsSection>
        <SkillsSection />
      </SettingsSection>
    </SettingsPage>
  )
}
