import { ActionIcon, Tooltip } from '@mantine/core'
import { IconPhoto } from '@tabler/icons-react'
import { forwardRef } from 'react'
import { desktopActionIconProps, mobileActionIconProps } from './actionIconStyles'

interface ImageUploadButtonProps {
  onClick: () => void
  tooltipLabel: string
  isMobile?: boolean
  size?: string | number
  variant?: string
}

export const ImageUploadButton = forwardRef<HTMLButtonElement, ImageUploadButtonProps>(
  ({ onClick, tooltipLabel, isMobile = false, size, variant }, ref) => {
    const actionIconProps = isMobile
      ? { ...mobileActionIconProps, color: 'chatbox-secondary' }
      : {
          ...desktopActionIconProps,
          size: size || desktopActionIconProps.size,
          variant: variant || desktopActionIconProps.variant,
        }

    return (
      <Tooltip label={tooltipLabel} withArrow position="top-start">
        <ActionIcon ref={ref} {...actionIconProps} onClick={onClick}>
          <IconPhoto strokeWidth={1.8} />
        </ActionIcon>
      </Tooltip>
    )
  }
)

ImageUploadButton.displayName = 'ImageUploadButton'
