import clsx from 'clsx'
import { useMemo } from 'react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export interface DividerProps {
  /**
   * Divider orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical'
  /**
   * Additional className
   */
  className?: string
}

/**
 * A divider component that adapts line width based on device pixel ratio (DPR)
 * to display ultra-thin lines on high-DPR displays (e.g., Retina displays)
 *
 * Uses transform scale to achieve sub-pixel rendering while maintaining
 * layout stability. The element maintains 1px size but is scaled down visually.
 * For example:
 * - DPR 1: scale 1 (1px)
 * - DPR 2: scale 0.5 (0.5px visual)
 * - DPR 3: scale 0.33 (0.33px visual)
 */
export const Divider = ({ orientation = 'horizontal', className }: DividerProps) => {
  const isSmallScreen = useIsSmallScreen()
  // Calculate scale factor based on DPR for ultra-thin lines
  const scale = useMemo(() => {
    if (!isSmallScreen || typeof window === 'undefined') return 1
    const dpr = window.devicePixelRatio || 1
    if (dpr > 1.5) {
      return 0.5
    } else {
      return 1
    }
  }, [isSmallScreen])

  const baseClasses = clsx('bg-chatbox-border-primary', className)

  if (orientation === 'vertical') {
    return (
      <div
        className={baseClasses}
        style={{
          width: '1px',
          transform: `scaleX(${scale})`,
          transformOrigin: 'center',
        }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div
      className={baseClasses}
      style={{
        height: '1px',
        transform: `scaleY(${scale})`,
        transformOrigin: 'center',
      }}
      aria-hidden="true"
    />
  )
}

export default Divider
