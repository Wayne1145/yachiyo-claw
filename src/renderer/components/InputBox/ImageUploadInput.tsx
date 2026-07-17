import type React from 'react'
import { forwardRef } from 'react'

interface ImageUploadInputProps {
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  accept?: string
  multiple?: boolean
  className?: string
  style?: React.CSSProperties
}

export const ImageUploadInput = forwardRef<HTMLInputElement, ImageUploadInputProps>(
  ({ onChange, accept = 'image/png, image/jpeg', multiple = true, className = 'hidden', style }, ref) => {
    return (
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
        className={className}
        style={style || { display: 'none' }}
      />
    )
  }
)

ImageUploadInput.displayName = 'ImageUploadInput'
