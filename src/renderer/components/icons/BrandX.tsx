import { MouseEventHandler } from 'react'

export default function BrandX(props: { className?: string; onClick?: MouseEventHandler<SVGSVGElement> }) {
  const { className, onClick } = props
  return (
    <svg className={className} onClick={onClick} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.6408 3H20.6866L14.0331 10.6239L21.8613 21H15.7327L10.9291 14.7082L5.43884 21H2.39013L9.50615 12.8427L2 3.00142H8.28468L12.6201 8.75126L17.6408 3ZM16.5697 19.1728H18.2579L7.36255 4.73219H5.55233L16.5697 19.1728Z"
        fill="currentColor"
      />
    </svg>
  )
}
