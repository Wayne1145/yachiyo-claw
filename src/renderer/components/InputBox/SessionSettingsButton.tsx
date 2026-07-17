import { ActionIcon, Tooltip } from '@mantine/core'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { forwardRef } from 'react'
import { ScalableIcon } from '../common/ScalableIcon'
import { desktopActionIconProps, mobileActionIconProps } from './actionIconStyles'

interface SessionSettingsButtonProps {
  onClick?: () => void | boolean | Promise<boolean>
  tooltipLabel: string
  disabled?: boolean
  isMobile?: boolean
  size?: string | number
  variant?: string
}

export const SessionSettingsButton = forwardRef<HTMLButtonElement, SessionSettingsButtonProps>(
  ({ onClick, tooltipLabel, disabled = false, isMobile = false, size, variant }, ref) => {
    const actionIconProps = isMobile
      ? { ...mobileActionIconProps, color: 'chatbox-secondary' }
      : {
          ...desktopActionIconProps,
          size: size || desktopActionIconProps.size,
          variant: variant || desktopActionIconProps.variant,
        }

    return (
      <Tooltip label={tooltipLabel} withArrow position="top-start">
        <ActionIcon ref={ref} {...actionIconProps} disabled={disabled || !onClick} onClick={onClick}>
          <ScalableIcon icon={IconAdjustmentsHorizontal} size={22} strokeWidth={1.8} />
        </ActionIcon>
      </Tooltip>
    )
  }
)

SessionSettingsButton.displayName = 'SessionSettingsButton'
