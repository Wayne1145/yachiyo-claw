import { createFileRoute } from '@tanstack/react-router'
import { ThemeCenter } from '@/components/yachiyo/ThemeCenter'

export const Route = createFileRoute('/settings/themes')({ component: ThemeCenter })
