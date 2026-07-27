import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { PluginPageHost } from '@/plugins/PluginPageHost'

function PluginPage() {
  const { pluginId } = Route.useParams()
  const pathDepth = useRouterState({ select: (state) => state.location.pathname.split('/').filter(Boolean).length })
  return pathDepth > 2 ? <Outlet /> : <PluginPageHost pluginId={pluginId} />
}

export const Route = createFileRoute('/plugin/$pluginId')({ component: PluginPage })
