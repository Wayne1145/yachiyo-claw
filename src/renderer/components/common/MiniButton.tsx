import type React from 'react'
import { forwardRef } from 'react'
import { Tooltip } from '@mantine/core'
import { cn } from '@/lib/utils'

interface MiniButtonProps {
  children: React.ReactNode
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  tooltipTitle?: React.ReactNode
  tooltipPlacement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'bottom-end'
    | 'bottom-start'
    | 'left-end'
    | 'left-start'
    | 'right-end'
    | 'right-start'
    | 'top-end'
    | 'top-start'
}

const MiniButton = forwardRef<HTMLButtonElement, MiniButtonProps>((props, ref) => {
  const { onClick, disabled, className, style, tooltipTitle, tooltipPlacement, children } = props
  const button = (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'bg-transparent hover:bg-slate-400/25',
        'border-none rounded',
        'h-8 w-8 p-1',
        disabled ? '' : 'cursor-pointer',
        className
      )}
      style={style}
    >
      {children}
    </button>
  )

  if (!tooltipTitle) {
    return button
  }

  return (
    <Tooltip
      openDelay={500}
      label={tooltipTitle}
      position={tooltipPlacement}
      withArrow
      styles={{
        tooltip: {
          fontSize: '12px',
          fontWeight: 400,
          backgroundColor: 'rgba(97, 97, 97, 0.9)',
          color: 'white',
        },
      }}
    >
      {button}
    </Tooltip>
  )
})

export default MiniButton
