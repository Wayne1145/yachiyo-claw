import { createFileRoute } from '@tanstack/react-router'
import { CodingProjectWorkspace } from '@/components/yachiyo/CodingWorkspace'

export const Route = createFileRoute('/develop/$projectId')({ component: CodingProjectWorkspace })
