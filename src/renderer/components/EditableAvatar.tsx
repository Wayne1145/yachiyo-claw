import { Badge, Box, IconButton, useTheme } from '@mui/material'
import Avatar from '@mui/material/Avatar'
import React, { useRef } from 'react'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'
import DeleteIcon from '@mui/icons-material/Delete'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

interface Props {
  children: React.ReactNode
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: () => void
  removable?: boolean
  sx?: SxProps<Theme>
}

export default function EditableAvatar(props: Props) {
  const theme = useTheme()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [showRemoveButton, setShowRemoveButton] = React.useState(false)
  const isSmallScreen = useIsSmallScreen()

  const onAvatarUpload = () => {
    avatarInputRef.current?.click()
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        paddingBottom: '15px',
      }}
    >
      <input
        type="file"
        ref={avatarInputRef}
        className="hidden"
        onChange={props.onChange}
        accept="image/png, image/jpeg"
      />
      <Badge
        overlap="circular"
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        onMouseEnter={() => setShowRemoveButton(true)}
        onMouseLeave={() => setShowRemoveButton(false)}
        invisible={!(props.removable && (isSmallScreen || showRemoveButton))}
        badgeContent={
          <Box>
            <IconButton
              onClick={props.onRemove}
              edge={'end'}
              size={'small'}
              disableRipple
              sx={{
                backgroundColor: theme.palette.error.main,
                color: theme.palette.error.contrastText,
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <Avatar
          sx={{
            width: '80px',
            height: '80px',
            ...props.sx,
          }}
          className="cursor-pointer"
          onClick={onAvatarUpload}
        >
          {props.children}
        </Avatar>
      </Badge>
    </Box>
  )
}
