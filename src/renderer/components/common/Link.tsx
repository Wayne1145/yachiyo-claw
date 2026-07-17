import platform from '@/platform'
import { useTheme } from '@mui/material'

export default function LinkTargetBlank(props: {
  children?: React.ReactNode | string
  href: string
  className?: string
  style?: React.CSSProperties
}) {
  const theme = useTheme()
  const { children, href, className, style } = props
  return (
    <a
      className={'font-normal cursor-pointer ' + (className ?? '')}
      style={{
        color: theme.palette.primary.main,
        ...style,
      }}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        platform.openLink(href)
      }}
      href={href}
      target="_blank"
    >
      {children}
    </a>
  )
}
