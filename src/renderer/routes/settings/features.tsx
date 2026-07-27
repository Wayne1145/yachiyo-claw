import { createFileRoute } from '@tanstack/react-router'
import { FeatureManager } from '@/components/yachiyo/FeatureManager'

export const Route = createFileRoute('/settings/features')({ component: FeatureManager })
