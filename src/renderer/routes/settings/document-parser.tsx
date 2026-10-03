import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { useTranslation } from 'react-i18next'
import { createFileRoute } from '@tanstack/react-router'
import { DocumentParserSettings } from '@/components/settings/DocumentParserSettings'

export const Route = createFileRoute('/settings/document-parser')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  return (
    <SettingsPage title={t('Document Parser')} description={t('文件解析与识别服务')}>
      <SettingsSection>
        <DocumentParserSettings showTitle={false} />
      </SettingsSection>
    </SettingsPage>
  )
}
