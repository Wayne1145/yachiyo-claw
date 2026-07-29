import { createFileRoute } from '@tanstack/react-router'
import { CodingHome } from '@/components/yachiyo/CodingWorkspace'

export const Route = createFileRoute('/develop')({ component: CodingHome })
