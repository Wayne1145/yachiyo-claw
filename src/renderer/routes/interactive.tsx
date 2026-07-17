import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AndroidInteractive } from '@/components/yachiyo/AndroidInteractive'

export const Route = createFileRoute('/interactive')({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: typeof search.sessionId === 'string' ? search.sessionId : undefined,
  }),
  component: InteractiveRoute,
})

function InteractiveRoute() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  return (
    <AndroidInteractive
      sessionId={search.sessionId}
      onSessionChange={(sessionId) =>
        void navigate({ to: '/interactive', search: { sessionId }, replace: true })
      }
    />
  )
}
