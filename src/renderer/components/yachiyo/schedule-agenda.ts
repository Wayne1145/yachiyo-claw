import type { ScheduledAgentTask } from '@/mobile/scheduled-agent-tasks'

export function isInactiveSchedule(task: ScheduledAgentTask): boolean {
  return !task.enabled || task.nativeStatus === 'paused' || task.nativeStatus === 'cancelled'
}

function localDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export interface ScheduleGroup {
  day: number | null
  tasks: ScheduledAgentTask[]
}

export function groupScheduleAgenda(tasks: ScheduledAgentTask[]): ScheduleGroup[] {
  const upcoming = new Map<number, ScheduledAgentTask[]>()
  const inactive: ScheduledAgentTask[] = []
  for (const task of [...tasks].sort((left, right) => left.runAt - right.runAt)) {
    if (isInactiveSchedule(task)) {
      inactive.push(task)
      continue
    }
    const day = localDay(task.runAt)
    const group = upcoming.get(day) ?? []
    group.push(task)
    upcoming.set(day, group)
  }
  const groups: ScheduleGroup[] = [...upcoming].map(([day, items]) => ({ day, tasks: items }))
  if (inactive.length) groups.push({ day: null, tasks: inactive.reverse() })
  return groups
}

export function scheduleStatusLabel(task: ScheduledAgentTask): string {
  if (task.nativeStatus === 'awaiting-approval') return '等待审批'
  if (task.nativeStatus === 'awaiting-foreground') return '等待应用打开'
  if (task.status === 'running' || task.nativeStatus === 'claimed') return '运行中'
  if (task.status === 'failed') return '失败'
  if (task.status === 'completed') return '已完成'
  if (isInactiveSchedule(task)) return '已暂停'
  return '等待中'
}

export function formatScheduleResult(result: string): string {
  try {
    const parsed: unknown = JSON.parse(result)
    if (parsed && typeof parsed === 'object' && 'text' in parsed && typeof parsed.text === 'string') return parsed.text
  } catch {
    // Older schedules can have plain-text results instead of the native JSON envelope.
  }
  return result
}

export function groupHeading(day: number, now: Date, locale: string): string {
  const today = localDay(now.getTime())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const offset = day === today ? 0 : day === tomorrow.getTime() ? 1 : undefined
  return offset === undefined
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric' }).format(day)
    : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day')
}
