import { createFileRoute } from '@tanstack/react-router'
import KnowledgeBasePage from '@/components/knowledge-base/KnowledgeBase'

export const Route = createFileRoute('/settings/knowledge-base')({
  component: KnowledgeBasePage,
})
