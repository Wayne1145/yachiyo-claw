export type FlowGlassEnvironment = 'chat' | 'interactive' | 'tasks' | 'settings'

const APPROVED_CHARACTER_TINTS = [
  'rgba(64, 156, 255, 0.08)',
  'rgba(255, 99, 146, 0.07)',
  'rgba(52, 199, 89, 0.07)',
  'rgba(255, 149, 0, 0.07)',
  'rgba(90, 200, 250, 0.08)',
  'rgba(175, 82, 222, 0.06)',
] as const

export function resolveFlowGlassEnvironment(pathname: string): FlowGlassEnvironment {
  if (pathname === '/interactive' || pathname.startsWith('/interactive/')) return 'interactive'
  if (
    pathname === '/tasks' ||
    pathname.startsWith('/tasks/') ||
    pathname === '/task' ||
    pathname.startsWith('/task/') ||
    pathname === '/develop' ||
    pathname.startsWith('/develop/') ||
    pathname.startsWith('/workspace') ||
    pathname.startsWith('/scheduled')
  ) {
    return 'tasks'
  }
  if (pathname === '/about' || pathname.startsWith('/settings') || pathname.startsWith('/plugin/')) return 'settings'
  return 'chat'
}

export function resolveApprovedCharacterTint(key: string | null | undefined): string {
  if (!key) return 'transparent'
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return APPROVED_CHARACTER_TINTS[(hash >>> 0) % APPROVED_CHARACTER_TINTS.length]
}
