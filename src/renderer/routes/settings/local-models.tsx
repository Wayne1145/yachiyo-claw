import { createFileRoute } from '@tanstack/react-router'
import { LocalModelCenter } from '@/components/yachiyo/LocalModelCenter'

export const Route = createFileRoute('/settings/local-models')({ component: LocalModelCenter })
