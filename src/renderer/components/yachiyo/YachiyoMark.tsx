import clsx from 'clsx'
import yachiyoMark from '../../../../assets/brand/yachiyo-avatar.png'

export function YachiyoMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <img
      src={yachiyoMark}
      width={size}
      height={size}
      className={clsx('block shrink-0 object-contain', className)}
      alt=""
      aria-hidden="true"
    />
  )
}
