import { useSyncExternalStore } from 'react'

export type AndroidShellLayout = 'portrait' | 'rail' | 'wide'

export function resolveAndroidShellLayout(width: number, landscape: boolean): AndroidShellLayout {
  if (!landscape || width < 520) return 'portrait'
  return width >= 720 ? 'wide' : 'rail'
}

function snapshot(): AndroidShellLayout {
  if (typeof window === 'undefined') return 'portrait'
  // The Android IME shrinks the viewport. Its height must not turn a portrait phone into a desktop layout.
  const orientation = window.screen.orientation?.type
  const landscape = orientation ? orientation.startsWith('landscape') : window.innerWidth > window.innerHeight
  return resolveAndroidShellLayout(window.innerWidth, landscape)
}

function subscribe(refresh: () => void) {
  window.addEventListener('resize', refresh)
  window.screen.orientation?.addEventListener('change', refresh)
  return () => {
    window.removeEventListener('resize', refresh)
    window.screen.orientation?.removeEventListener('change', refresh)
  }
}

export function useAndroidShellLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => 'portrait' as const)
}
