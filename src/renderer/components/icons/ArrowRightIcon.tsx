import { MouseEventHandler } from 'react'

export default function ArrowRightIcon(props: { className?: string; onClick?: MouseEventHandler<SVGSVGElement> }) {
  const { className, onClick } = props
  return (
    <svg
      className={className}
      onClick={onClick}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}
