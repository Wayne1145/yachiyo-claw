import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import { deleteSessions, listAllSessionsMeta } from '@/stores/chatStore'

const CLEANUP_KEY = 'yachiyo-demo-session-cleanup-v1'
const demoIds = new Set([...defaultSessionsForCN, ...defaultSessionsForEN].map((session) => session.id))

export async function removeBuiltInDemoSessions(): Promise<void> {
  if (localStorage.getItem(CLEANUP_KEY) === 'true') return
  const records = await listAllSessionsMeta()
  const ids = records.filter((record) => demoIds.has(record.id)).map((record) => record.id)
  if (ids.length) await deleteSessions(ids)
  localStorage.setItem(CLEANUP_KEY, 'true')
}
