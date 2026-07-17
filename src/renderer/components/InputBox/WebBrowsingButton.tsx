import { ActionIcon } from '@mantine/core'
import { IconWorld } from '@tabler/icons-react'
import { forwardRef } from 'react'
import { ScalableIcon } from '../common/ScalableIcon'
import { desktopActionIconProps, mobileActionIconProps } from './actionIconStyles'

interface WebBrowsingButtonProps {
  active: boolean
  onClick: () => void
  isMobile?: boolean
  size?: string | number
  variant?: string
}

export const WebBrowsingButton = forwardRef<HTMLButtonElement, WebBrowsingButtonProps>(
  ({ active, onClick, isMobile = false, size, variant }, ref) => {
    const actionIconProps = isMobile
      ? { ...mobileActionIconProps, color: active ? 'chatbox-brand' : 'chatbox-secondary' }
      : {
          ...desktopActionIconProps,
          size: size || desktopActionIconProps.size,
          variant: variant || desktopActionIconProps.variant,
          color: active ? 'chatbox-brand' : 'chatbox-secondary',
        }

    return (
      <ActionIcon ref={ref} {...actionIconProps} onClick={onClick}>
        <ScalableIcon icon={IconWorld} size={22} strokeWidth={1.8} />
      </ActionIcon>
    )
  }
)

WebBrowsingButton.displayName = 'WebBrowsingButton'
