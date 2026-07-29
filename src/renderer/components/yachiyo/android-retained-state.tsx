import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

interface RetainedScrollPosition {
  top: number
  left: number
}

const retainedValues = new Map<string, unknown>()
const retainedScroll = new Map<string, RetainedScrollPosition[]>()
const MAX_RETAINED_LOCATIONS = 40

function refreshBoundedEntry<T>(store: Map<string, T>, key: string, value: T): void {
  store.delete(key)
  store.set(key, value)
  while (store.size > MAX_RETAINED_LOCATIONS) {
    const oldestKey = store.keys().next().value
    if (typeof oldestKey !== 'string') break
    store.delete(oldestKey)
  }
}

export function useAndroidRetainedState<T>(
  key: string | undefined,
  initialValue: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const readValue = (nextKey: string | undefined): T => {
    if (nextKey && retainedValues.has(nextKey)) return retainedValues.get(nextKey) as T
    return typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  }
  const [entry, setEntry] = useState<{ key: string | undefined; value: T }>(() => {
    return { key, value: readValue(key) }
  })
  const value = entry.key === key ? entry.value : readValue(key)
  const keyRef = useRef(key)
  const valueRef = useRef(value)
  keyRef.current = key
  valueRef.current = value

  useLayoutEffect(() => {
    if (entry.key !== key) {
      if (entry.key) refreshBoundedEntry(retainedValues, entry.key, entry.value)
      setEntry({ key, value })
      return
    }
    if (key) refreshBoundedEntry(retainedValues, key, entry.value)
  }, [entry, key, value])

  const setValue: Dispatch<SetStateAction<T>> = useCallback((nextValue) => {
    setEntry((current) => {
      const activeKey = keyRef.current
      const currentValue = current.key === activeKey ? current.value : valueRef.current
      return {
        key: activeKey,
        value: typeof nextValue === 'function' ? (nextValue as (previous: T) => T)(currentValue) : nextValue,
      }
    })
  }, [])

  return [value, setValue]
}

function getScrollableDescendants(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].filter(
    (element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
  )
}

export function useAndroidRetainedScroll(key: string): RefObject<HTMLDivElement> {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const savedPositions = retainedScroll.get(key)
    const frame = window.requestAnimationFrame(() => {
      if (!savedPositions) return
      const nodes = getScrollableDescendants(root)
      savedPositions.forEach((position, index) => {
        const node = nodes[index]
        if (!node) return
        node.scrollTo({ top: position.top, left: position.left, behavior: 'instant' })
      })
    })

    return () => {
      window.cancelAnimationFrame(frame)
      const positions = getScrollableDescendants(root).map((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
      }))
      refreshBoundedEntry(retainedScroll, key, positions)
    }
  }, [key])

  return rootRef
}

export function AndroidRetainedTabSurface({ stateKey, children }: { stateKey: string; children: ReactNode }) {
  const ref = useAndroidRetainedScroll(stateKey)
  return (
    <div ref={ref} className="yachiyo-retained-tab-surface" data-retained-state-key={stateKey}>
      {children}
    </div>
  )
}
