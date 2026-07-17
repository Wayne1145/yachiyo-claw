import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined'
import CircularProgressIcon from '@mui/material/CircularProgress'
import { useQuery } from '@tanstack/react-query'
import type React from 'react'
import { forwardRef, memo } from 'react'
import { useFetchBlob } from '@/hooks/useBlob'

export const ImageInStorage = memo(
  forwardRef<
    HTMLImageElement,
    {
      storageKey: string
      className?: string
      onClick?: (e: React.MouseEvent<HTMLImageElement>) => void
    }
  >((props, ref) => {
    const fetchBlob = useFetchBlob()
    const { data: base64 } = useQuery({
      queryKey: ['image-in-storage', props.storageKey],
      queryFn: async ({ queryKey: [, storageKey] }) => {
        const blob = await fetchBlob(storageKey as string)
        return blob ? blob : false
      },
      staleTime: Infinity,
      gcTime: 60 * 1000,
    })

    if (!base64) {
      return (
        <div className={`bg-slate-300/50 w-full h-full ${props.className || ''}`}>
          <div className="w-full h-full flex items-center justify-center">
            {base64 === false ? (
              <BrokenImageOutlinedIcon className="block max-w-full max-h-full opacity-50" />
            ) : (
              <CircularProgressIcon className="block max-w-full max-h-full opacity-50" color="secondary" />
            )}
          </div>
        </div>
      )
    }
    const picBase64 = base64.startsWith('data:image/') ? base64 : `data:image/png;base64,${base64}`
    return (
      <img
        ref={ref}
        src={picBase64}
        className={`max-w-full max-h-full ${props.className || ''}`}
        onClick={props.onClick}
      />
    )
  })
)

export function Img(props: {
  src: string
  className?: string
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void
}) {
  return <img src={props.src} className={`max-w-full max-h-full ${props.className || ''}`} onClick={props.onClick} />
}

export function handleImageInputAndSave(
  file: File,
  key: string,
  updateKey?: (key: string) => void,
  saveFn?: (key: string, value: string) => Promise<unknown>
) {
  if (file.type.startsWith('image/')) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      if (e.target && e.target.result) {
        const base64 = e.target.result as string
        if (saveFn) {
          await saveFn(key, base64)
        }
        if (updateKey) {
          updateKey(key)
        }
      }
    }
    reader.readAsDataURL(file)
  }
}
