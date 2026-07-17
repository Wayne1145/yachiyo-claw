import { createFileRoute } from '@tanstack/react-router'
import SimplePreview from '@/components/ModelSelector/SimplePreview'

export const Route = createFileRoute('/dev/model-selector')({
  component: SimplePreview,
})
