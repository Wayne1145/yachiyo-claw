import { createFileRoute } from '@tanstack/react-router'
import { DocumentParserSettings } from '@/components/settings/DocumentParserSettings'

export const Route = createFileRoute('/settings/document-parser')({
  component: RouteComponent,
})

export function RouteComponent() {
  return <DocumentParserSettings showTitle={false} />
}
