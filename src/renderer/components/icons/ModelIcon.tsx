import { useComputedColorScheme } from '@mantine/core'
import type { ModelProvider } from '@shared/types'
import { renderModelIcon } from '@/utils/modelLogo'
import ProviderIcon from './ProviderIcon'

interface ModelIconProps {
  modelId: string
  providerId?: ModelProvider | string
  size?: number
  className?: string
}

/**
 * Display a model-specific icon with fallback to provider icon.
 * Uses @lobehub/icons for model-specific icons with proper dark mode support.
 *
 * Priority:
 * 1. Model-specific icon (based on modelId)
 * 2. Provider icon (if providerId is provided)
 * 3. First letter avatar (as final fallback)
 */
export function ModelIcon({ modelId, providerId, size = 16, className }: ModelIconProps) {
  const colorScheme = useComputedColorScheme('light')
  const isDarkMode = colorScheme === 'dark'

  const icon = renderModelIcon(modelId, size, isDarkMode)

  if (icon) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
    )
  }

  // Fallback to ProviderIcon if no model-specific icon
  if (providerId) {
    return <ProviderIcon provider={providerId} size={size} className={className} />
  }

  // Final fallback: first letter avatar
  const firstLetter = modelId.charAt(0).toUpperCase()
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: 'var(--mantine-color-gray-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.6,
        fontWeight: 500,
        color: 'var(--mantine-color-gray-7)',
      }}
    >
      {firstLetter}
    </div>
  )
}
