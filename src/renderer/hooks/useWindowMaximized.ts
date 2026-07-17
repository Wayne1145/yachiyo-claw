import { atom, useAtomValue } from 'jotai'
import platform from '@/platform'

export const windowMaximizedAtom = atom(false)

windowMaximizedAtom.onMount = (set) => {
  const check = async () => {
    set(await platform.isMaximized())
  }
  check().catch(() => null)

  const unsubscribe = platform.onMaximizedChange((maximized) => set(maximized))
  return unsubscribe
}

export const useWindowMaximized = () => {
  return useAtomValue(windowMaximizedAtom)
}
