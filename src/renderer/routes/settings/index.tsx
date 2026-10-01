import { createFileRoute } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { z } from 'zod'
import { SettingsNavigation } from '@/components/settings/SettingsNavigation'

const searchSchema = z.object({
  settings: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  return <SettingsNavigation />
}
