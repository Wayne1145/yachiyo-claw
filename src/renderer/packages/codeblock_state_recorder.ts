export interface CodeblockState {
  collapsed: boolean
  shouldCollapse: boolean
  lines: number
}

// LRU-like cache with max size to prevent unbounded memory growth
const MAX_CACHE_SIZE = 500
const memoryStore = new Map<string, CodeblockState>()

function limitCacheSize() {
  if (memoryStore.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (first inserted) to get back to 80% of max size
    const targetSize = Math.floor(MAX_CACHE_SIZE * 0.8)
    const keysToDelete = Array.from(memoryStore.keys()).slice(0, memoryStore.size - targetSize)
    for (const key of keysToDelete) {
      memoryStore.delete(key)
    }
  }
}

function getID(content: string, language: string) {
  let hash = 0
  const combined = content + language
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }
  return hash.toString()
}

interface Options {
  content: string
  language: string
  generating?: boolean
  preferCollapsed?: boolean
}

export function needCollapse(options: Options): CodeblockState {
  if (options.generating) {
    return {
      collapsed: false,
      shouldCollapse: false,
      lines: 0,
    }
  }
  const id = getID(options.content, options.language)
  if (memoryStore.has(id)) {
    return memoryStore.get(id)!
  }
  return calculateState(options)
}

export function saveState(options: Options & { collapsed: boolean }) {
  const id = getID(options.content, options.language)
  const newState = calculateState(options)
  newState.collapsed = options.collapsed
  memoryStore.set(id, newState)
  limitCacheSize()
  return newState
}

export function calculateState(options: Options): CodeblockState {
  const lines = options.content.split('\n').length
  const shouldCollapse = !!options.preferCollapsed && lines > 6
  const collapsed = shouldCollapse
  return {
    collapsed,
    shouldCollapse,
    lines,
  }
}
