import { useMantineTheme } from '@mantine/core'
import type { IconProps } from '@tabler/icons-react'
import { type ComponentType, type ElementType, type ForwardedRef, forwardRef } from 'react'

type Props = Omit<IconProps, 'size'> & {
  size?: number
  icon: ElementType<IconProps>
}

function ScalableIconInner({ icon: IconComponent, size = 16, ...others }: Props, ref: ForwardedRef<SVGSVGElement>) {
  const theme = useMantineTheme()
  const scale = theme.scale ?? 1
  const Icon = IconComponent as ComponentType<IconProps & { ref?: ForwardedRef<SVGSVGElement> }>
  return <Icon ref={ref} size={size * scale} {...others} />
}

export const ScalableIcon = forwardRef(ScalableIconInner)
