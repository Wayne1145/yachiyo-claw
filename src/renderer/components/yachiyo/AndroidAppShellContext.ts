import { createContext, useContext } from 'react'

export const AndroidAppShellContext = createContext(false)

export function useInAndroidAppShell(): boolean {
  return useContext(AndroidAppShellContext)
}
