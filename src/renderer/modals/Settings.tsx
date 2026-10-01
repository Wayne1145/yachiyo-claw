import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { router } from '@/router'

/** Keep existing settings links working while all pages use the main route tree. */
export default function SettingsModal() {
  const { search } = useLocation()
  const legacyPath = (search as { settings?: string }).settings
  useEffect(() => {
    if (!legacyPath) return
    const target = /^\/settings(?:\/|$)/.test(legacyPath) ? legacyPath : '/settings'
    void router.navigate({ to: target as '/settings', search: {}, replace: true })
  }, [legacyPath])
  return null
}

export function navigateToSettings(path = '') {
  const target = `/settings${path && path !== '/' ? (path.startsWith('/') ? path : `/${path}`) : ''}`
  void router.navigate({ to: target as '/settings', search: {} })
}
