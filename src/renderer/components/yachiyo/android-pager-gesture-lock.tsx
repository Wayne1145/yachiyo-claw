import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface AndroidPagerGestureLockValue {
  locked: boolean
  acquire: () => () => void
}

const AndroidPagerGestureLockContext = createContext<AndroidPagerGestureLockValue | null>(null)

const ANDROID_PAGER_BLOCKING_LAYER_SELECTOR = [
  '[data-yachiyo-pager-gesture-lock="true"]',
  '[data-menu-dropdown]',
  '[data-rmiz-modal-overlay]',
  '[data-vaul-drawer]',
  '.mantine-Menu-dropdown',
  '.mantine-Popover-dropdown',
  '.mantine-Combobox-dropdown',
  '.mantine-Modal-root',
  '.mantine-Drawer-root',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(',')

const BLOCKING_LAYER_DISCOVERY_ATTRIBUTES = [
  'class',
  'role',
  'data-menu-dropdown',
  'data-rmiz-modal-overlay',
  'data-vaul-drawer',
  'data-yachiyo-pager-gesture-lock',
]

const BLOCKING_LAYER_VISIBILITY_ATTRIBUTES = ['style', 'hidden', 'aria-hidden', 'data-hidden', 'data-state']

function isVisibleBlockingLayer(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [data-hidden], [data-state="closed"]')) return false
  if (!(element instanceof HTMLElement) || typeof window === 'undefined') return true
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Portaled overlays are outside the pager DOM, but React portal events still follow the
 * component tree. Check their semantic surface synchronously on pointer-down so an outside
 * dismissal gesture cannot also begin a tab swipe.
 */
export function hasOpenAndroidPagerBlockingLayer(root?: ParentNode): boolean {
  const queryRoot = root ?? (typeof document === 'undefined' ? undefined : document)
  if (!queryRoot) return false
  return Array.from(queryRoot.querySelectorAll(ANDROID_PAGER_BLOCKING_LAYER_SELECTOR)).some(isVisibleBlockingLayer)
}

export function AndroidPagerGestureLockProvider({ children }: { children: ReactNode }) {
  const [lockCount, setLockCount] = useState(0)
  const [portalLayerOpen, setPortalLayerOpen] = useState(false)
  const acquire = useCallback(() => {
    let released = false
    setLockCount((count) => count + 1)
    return () => {
      if (released) return
      released = true
      setLockCount((count) => Math.max(0, count - 1))
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const observationRoot = document.body ?? document.documentElement
    if (!observationRoot) return

    const layerObservers = new Map<Element, MutationObserver>()
    let blockingLayers: Element[] = []

    const updateOpenState = () => {
      const nextOpen = blockingLayers.some(isVisibleBlockingLayer)
      setPortalLayerOpen((currentOpen) => (currentOpen === nextOpen ? currentOpen : nextOpen))
    }

    const synchronizeBlockingLayers = () => {
      const nextLayers = Array.from(document.querySelectorAll(ANDROID_PAGER_BLOCKING_LAYER_SELECTOR))
      const nextLayerSet = new Set(nextLayers)

      for (const [layer, observer] of layerObservers) {
        if (nextLayerSet.has(layer)) continue
        observer.disconnect()
        layerObservers.delete(layer)
      }

      for (const layer of nextLayers) {
        if (layerObservers.has(layer)) continue
        const observer = new MutationObserver(updateOpenState)
        observer.observe(layer, {
          attributes: true,
          attributeFilter: BLOCKING_LAYER_VISIBILITY_ATTRIBUTES,
        })
        layerObservers.set(layer, observer)
      }

      blockingLayers = nextLayers
      updateOpenState()
    }

    const discoveryObserver = new MutationObserver((mutations) => {
      const needsDiscovery = mutations.some(
        (mutation) =>
          mutation.type === 'childList' || BLOCKING_LAYER_DISCOVERY_ATTRIBUTES.includes(mutation.attributeName ?? '')
      )
      if (needsDiscovery) synchronizeBlockingLayers()
      else updateOpenState()
    })
    discoveryObserver.observe(observationRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...BLOCKING_LAYER_DISCOVERY_ATTRIBUTES, ...BLOCKING_LAYER_VISIBILITY_ATTRIBUTES.slice(1)],
    })
    synchronizeBlockingLayers()

    return () => {
      discoveryObserver.disconnect()
      for (const observer of layerObservers.values()) observer.disconnect()
      layerObservers.clear()
    }
  }, [])

  const value = useMemo(
    () => ({ locked: lockCount > 0 || portalLayerOpen, acquire }),
    [acquire, lockCount, portalLayerOpen]
  )

  return <AndroidPagerGestureLockContext.Provider value={value}>{children}</AndroidPagerGestureLockContext.Provider>
}

export function useAndroidPagerGestureLock(active: boolean): void {
  const context = useContext(AndroidPagerGestureLockContext)
  useEffect(() => {
    if (!active || !context) return
    return context.acquire()
  }, [active, context])
}

export function useAndroidPagerGesturesLocked(): boolean {
  return useContext(AndroidPagerGestureLockContext)?.locked ?? false
}
