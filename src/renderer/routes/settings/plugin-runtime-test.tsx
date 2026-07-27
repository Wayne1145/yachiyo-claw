import { createFileRoute } from '@tanstack/react-router'
import { PluginRuntimeTest } from '@/components/yachiyo/PluginRuntimeTest'

export const Route = createFileRoute('/settings/plugin-runtime-test')({ component: PluginRuntimeTest })
