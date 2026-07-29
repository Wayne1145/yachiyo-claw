import type { MotionValue } from 'framer-motion'
import { createContext, type ReactNode, useContext } from 'react'

export interface AndroidPagerPagePresentation {
  role: 'source' | 'target'
  transitioning: boolean
  direction: -1 | 1
  progress?: MotionValue<number>
}

const DEFAULT_PRESENTATION: AndroidPagerPagePresentation = {
  role: 'source',
  transitioning: false,
  direction: 1,
}

const AndroidPagerPagePresentationContext = createContext(DEFAULT_PRESENTATION)

export function AndroidPagerPagePresentationProvider({
  value,
  children,
}: {
  value: AndroidPagerPagePresentation
  children: ReactNode
}) {
  return (
    <AndroidPagerPagePresentationContext.Provider value={value}>
      {children}
    </AndroidPagerPagePresentationContext.Provider>
  )
}

export function useAndroidPagerPagePresentation(): AndroidPagerPagePresentation {
  return useContext(AndroidPagerPagePresentationContext)
}
