import { createFileRoute } from '@tanstack/react-router'
import { DownloadsCenter } from '@/components/yachiyo/DownloadsCenter'

export const Route = createFileRoute('/settings/downloads')({ component: DownloadsCenter })
