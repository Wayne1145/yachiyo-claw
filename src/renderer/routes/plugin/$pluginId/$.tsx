import { createFileRoute } from '@tanstack/react-router'
import { PluginPageHost } from '@/plugins/PluginPageHost'

function PluginChildPage() {
  return <PluginPageHost pluginId={Route.useParams().pluginId} />
}

export const Route = createFileRoute('/plugin/$pluginId/$')({ component: PluginChildPage })
