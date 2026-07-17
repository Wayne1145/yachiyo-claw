import { type ReactElement, useEffect, useRef } from 'react'
import markjs from 'mark.js'

export default function Mark(props: { children: string | ReactElement; marks: string[] }) {
  const { children, marks } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) {
      return
    }
    const markInstance = new markjs(ref.current)
    markInstance.mark(marks)
  }, [children, ref.current, marks])
  return <div ref={ref}>{children}</div>
}
