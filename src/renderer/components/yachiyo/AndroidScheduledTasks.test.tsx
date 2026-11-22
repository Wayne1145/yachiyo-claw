/** @vitest-environment jsdom */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { ScheduledAgentTask } from '@/mobile/scheduled-agent-tasks'
import { AndroidScheduledTasks } from './AndroidScheduledTasks'
import { formatScheduleResult, groupHeading, groupScheduleAgenda, scheduleStatusLabel } from './schedule-agenda'

const api = vi.hoisted(() => ({
  records: [] as ScheduledAgentTask[],
  create: vi.fn(),
  update: vi.fn(),
  run: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@/mobile/scheduled-agent-tasks', () => ({
  useScheduledAgentTasks: () => api.records,
  createScheduledAgentTask: api.create,
  deleteScheduledAgentTask: api.remove,
  updateScheduledAgentTask: api.update,
  executeScheduledAgentTask: api.run,
  installScheduledAgentTaskRunner: vi.fn(),
}))
vi.mock('@/router', () => ({ router: { navigate: api.navigate } }))
vi.mock('@/components/common/AdaptiveModal', () => ({
  AdaptiveModal: Object.assign(
    ({ opened, title, children }: { opened: boolean; title: string; children: ReactNode }) =>
      opened ? (
        <section role="dialog" aria-label={title}>
          {children}
        </section>
      ) : null,
    { Actions: ({ children }: { children: ReactNode }) => <>{children}</> }
  ),
}))

const start = new Date(2030, 5, 15, 9).getTime()
function record(id: string, change: Partial<ScheduledAgentTask> = {}): ScheduledAgentTask {
  return {
    id,
    title: id,
    prompt: `${id} prompt`,
    runAt: start,
    repeat: 'daily',
    enabled: true,
    status: 'scheduled',
    createdAt: start - 5000,
    ...change,
  }
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
})
beforeEach(async () => {
  api.records = []
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})
afterEach(cleanup)
const view = () => (
  <MantineProvider>
    <AndroidScheduledTasks />
  </MantineProvider>
)

describe('scheduled task agenda', () => {
  it('groups local calendar days, keeps disabled items visible, and preserves the scheduler’s input order', () => {
    const tasks = [record('later', { runAt: start + 3 * 86400000 }), record('off', { enabled: false }), record('ready')]
    expect(groupScheduleAgenda(tasks).map((group) => group.tasks.map((task) => task.id))).toEqual([
      ['ready'],
      ['later'],
      ['off'],
    ])
    expect(tasks.map((task) => task.id)).toEqual(['later', 'off', 'ready'])
    const today = new Date(2030, 5, 15)
    expect(groupHeading(today.getTime(), today, 'en')).toBe('today')
    expect(groupHeading(new Date(2030, 5, 16).getTime(), today, 'en')).toBe('tomorrow')
    expect(scheduleStatusLabel(record('a', { nativeStatus: 'awaiting-approval' }))).toBe('等待审批')
    expect(scheduleStatusLabel(record('finished', { enabled: false, status: 'completed' }))).toBe('已完成')
    expect(formatScheduleResult('{"text":42}')).toBe('{"text":42}')
    expect(formatScheduleResult('legacy text')).toBe('legacy text')
  })

  it('counts enabled switches even when the current native execution is paused', () => {
    api.records = [record('Paused run', { nativeStatus: 'paused' }), record('Disabled plan', { enabled: false })]
    render(view())
    expect(screen.getByText('Enabled: 1 of 2')).toBeTruthy()
    const list = screen.getByRole('region', { name: 'Scheduled task list' })
    fireEvent.click(within(list).getByRole('button', { name: /Paused run/ }))
    const details = screen.getByRole('region', { name: 'Task details' })
    expect((within(details).getByRole('switch') as HTMLInputElement).checked).toBe(true)
    expect(within(details).getByText(String(i18n.t('已暂停')))).toBeTruthy()
  })

  it('keeps the selected detail across tab remounts and routes manual execution, history and pause to that schedule only', async () => {
    api.records = [
      record('Alpha'),
      record('Beta', {
        runAt: start + 86400000,
        lastError: 'offline',
        lastResult: '{"text":"cached result"}',
        lastSessionId: 'run-beta',
      }),
    ]
    const first = render(view())
    fireEvent.click(screen.getByRole('button', { name: /Beta.*Daily/ }))
    const details = screen.getByRole('region', { name: 'Task details' })
    expect(within(details).getByText('Beta prompt')).toBeTruthy()
    expect(within(details).getByText('offline')).toBeTruthy()
    expect(within(details).getByText('cached result')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Beta.*Daily/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(details).getByRole('switch'))
    expect(api.update).toHaveBeenCalledWith('Beta', { enabled: false, status: 'scheduled' })
    fireEvent.click(within(details).getByRole('button', { name: 'Open run conversation' }))
    expect(api.navigate).toHaveBeenCalledWith({ to: '/task/$taskId', params: { taskId: 'run-beta' } })
    api.run.mockRejectedValueOnce(new Error('agent_busy'))
    fireEvent.click(within(details).getByRole('button', { name: 'Run now' }))
    expect(api.run).toHaveBeenCalledWith('Beta', { navigateToConversation: true, consumeSchedule: false })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already running'))
    first.unmount()
    render(view())
    expect(within(screen.getByRole('region', { name: 'Task details' })).getByText('Beta prompt')).toBeTruthy()
  })

  it('requires explicit deletion of the named task and falls back to another record on a native refresh', () => {
    api.records = [record('Keep'), record('Remove')]
    const result = render(view())
    fireEvent.click(screen.getByRole('button', { name: /Remove.*Daily/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Remove' }))
    let sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(/“Remove”/)).toBeTruthy()
    fireEvent.click(within(sheet).getByText('Cancel'))
    expect(api.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Remove' }))
    sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    expect(api.remove).toHaveBeenCalledWith('Remove')
    api.records = [api.records[0]]
    result.rerender(view())
    expect(screen.getByRole('heading', { name: 'Keep' })).toBeTruthy()
  })

  it('creates the first real schedule from its empty state and selects the created item', () => {
    api.create.mockImplementationOnce((fields: Partial<ScheduledAgentTask>) => {
      const task = record('Created', fields)
      api.records = [task]
      return task
    })
    render(view())
    expect(screen.getByText('No scheduled tasks')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New scheduled task' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Backup' } })
    fireEvent.change(within(sheet).getByLabelText('Agent instruction'), { target: { value: 'Write a summary' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save task' }))
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Backup', prompt: 'Write a summary', repeat: 'once' })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Task details' })).getByText('Write a summary')).toBeTruthy()
  })
})
