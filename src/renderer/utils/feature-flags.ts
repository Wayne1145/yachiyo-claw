import platform from '@/platform'

export const featureFlags = {
  mcp: true,
  knowledgeBase: platform.type === 'desktop',
  skills: true,
  taskMode: false,
}
