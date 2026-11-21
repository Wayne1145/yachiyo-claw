import { createFileRoute } from '@tanstack/react-router'
import { PluginCenter } from '@/components/yachiyo/PluginCenter'

export const Route = createFileRoute('/settings/plugins')({
  validateSearch: (search: Record<string, unknown>): { plugin?: string } =>
    typeof search.plugin === 'string' && /^[a-z0-9-]{1,80}$/.test(search.plugin) ? { plugin: search.plugin } : {},
  component: PluginSettings,
})

function PluginSettings() {
  return <PluginCenter focusPluginId={Route.useSearch().plugin} />
}
