import { createFileRoute } from '@tanstack/react-router'
import { PluginCenter } from '@/components/yachiyo/PluginCenter'

export const Route = createFileRoute('/settings/plugins')({ component: PluginCenter })
