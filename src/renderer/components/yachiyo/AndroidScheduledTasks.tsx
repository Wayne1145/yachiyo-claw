import { ActionIcon, Alert, Button, Select, Switch, Textarea, TextInput } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconChevronRight,
  IconClock,
  IconHistory,
  IconPlayerPlay,
  IconRepeat,
  IconTrash,
} from '@tabler/icons-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  createScheduledAgentTask,
  deleteScheduledAgentTask,
  executeScheduledAgentTask,
  installScheduledAgentTaskRunner,
  type ScheduledAgentTask,
  type ScheduledTaskRepeat,
  updateScheduledAgentTask,
  useScheduledAgentTasks,
} from '@/mobile/scheduled-agent-tasks'
import { router } from '@/router'
import { useAndroidRetainedState } from './android-retained-state'
import {
  formatScheduleResult,
  groupHeading,
  groupScheduleAgenda,
  isInactiveSchedule,
  scheduleStatusLabel,
} from './schedule-agenda'
import './schedule-agenda.css'

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp)
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const repeatLabel: Record<ScheduledTaskRepeat, string> = { once: '仅一次', daily: '每天', weekly: '每周' }

export function AndroidScheduledTaskRunner() {
  useEffect(() => installScheduledAgentTaskRunner(), [])
  return null
}

function ScheduleForm({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [runAt, setRunAt] = useState(() => toLocalDateTimeInput(Date.now() + 5 * 60_000))
  const [repeat, setRepeat] = useState<ScheduledTaskRepeat>('once')
  const [error, setError] = useState('')

  const handleCreate = () => {
    setError('')
    try {
      const timestamp = new Date(runAt).getTime()
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('schedule_time_in_past')
      const task = createScheduledAgentTask({ title, prompt, runAt: timestamp, repeat })
      onCreated(task.id)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(
        message === 'task_prompt_required'
          ? String(t('请输入任务指令'))
          : message === 'schedule_time_in_past'
            ? String(t('执行时间必须晚于当前时间'))
            : message
      )
    }
  }

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title={t('新建定时任务')} centered>
      <div className="yachiyo-scheduled-task-form">
        <TextInput
          label={t('名称')}
          placeholder={String(t('例如：每日整理通知'))}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Textarea
          label={t('Agent 指令')}
          placeholder={String(t('描述需要 Agent 完成的操作'))}
          minRows={3}
          autosize
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
        <TextInput
          type="datetime-local"
          label={t('执行时间')}
          leftSection={<IconClock size={17} />}
          min={toLocalDateTimeInput(Date.now() + 60_000)}
          value={runAt}
          onChange={(event) => setRunAt(event.currentTarget.value)}
        />
        <Select
          label={t('重复')}
          leftSection={<IconRepeat size={17} />}
          value={repeat}
          data={Object.entries(repeatLabel).map(([value, label]) => ({ value, label: String(t(label)) }))}
          onChange={(value) => setRepeat((value as ScheduledTaskRepeat) || 'once')}
        />
        {error && (
          <Alert role="alert" color="red">
            {error}
          </Alert>
        )}
        <AdaptiveModal.Actions>
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button className="yachiyo-primary-button" onClick={handleCreate}>
            {t('保存任务')}
          </Button>
        </AdaptiveModal.Actions>
      </div>
    </AdaptiveModal>
  )
}

function ScheduleDetail({
  task,
  locale,
  onRun,
  onDelete,
  busy,
}: {
  task: ScheduledAgentTask
  locale: string
  onRun: () => void
  onDelete: () => void
  busy: string | null
}) {
  const { t } = useTranslation()
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const hasHistory = Boolean(task.lastRunAt || task.lastSessionId || task.lastResult || task.lastError)
  const running = task.status === 'running' || task.nativeStatus === 'claimed' || busy === task.id
  const status = scheduleStatusLabel(task)
  return (
    <>
      <div className="schedule-detail-heading">
        <span className="schedule-kicker">
          <IconClock aria-hidden="true" size={16} />
          {t('任务详情')}
        </span>
        <h2>{task.title}</h2>
        <span
          className="schedule-status"
          data-tone={task.status === 'failed' ? 'error' : isInactiveSchedule(task) ? 'muted' : 'active'}
        >
          {t(status)}
        </span>
      </div>
      <section className="schedule-instruction">
        <h3>{t('Agent 指令')}</h3>
        <p>{task.prompt}</p>
      </section>
      <dl className="schedule-facts">
        <div>
          <dt>{t(isInactiveSchedule(task) ? '执行时间' : '下次执行')}</dt>
          <dd>{fullDate.format(task.runAt)}</dd>
        </div>
        <div>
          <dt>{t('重复')}</dt>
          <dd>{t(repeatLabel[task.repeat])}</dd>
        </div>
        <div>
          <dt>{t('启用状态')}</dt>
          <dd>
            <Switch
              size="md"
              checked={task.enabled}
              aria-label={`${task.title} ${t('启用状态')}`}
              disabled={running}
              onChange={(event) =>
                updateScheduledAgentTask(task.id, {
                  enabled: event.currentTarget.checked,
                  status: event.currentTarget.checked ? 'scheduled' : task.status,
                })
              }
            />
          </dd>
        </div>
      </dl>
      <div className="schedule-action-row">
        <Button
          className="yachiyo-primary-button"
          leftSection={<IconPlayerPlay size={17} />}
          loading={busy === task.id}
          disabled={Boolean(busy) || running}
          onClick={onRun}
        >
          {t('立即运行')}
        </Button>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={44}
          disabled={running}
          aria-label={`${t('删除')} ${task.title}`}
          title={String(t('删除'))}
          onClick={onDelete}
        >
          <IconTrash size={18} />
        </ActionIcon>
      </div>
      {hasHistory && (
        <section className="schedule-run-history">
          <h3>
            <IconHistory size={17} aria-hidden="true" />
            {t('上次执行')}
          </h3>
          {task.lastRunAt && (
            <time dateTime={new Date(task.lastRunAt).toISOString()}>{fullDate.format(task.lastRunAt)}</time>
          )}
          {task.lastError && <p className="schedule-last-error">{t(task.lastError)}</p>}
          {task.lastResult && <p>{formatScheduleResult(task.lastResult)}</p>}
          {task.lastSessionId && (
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => {
                if (task.lastSessionId)
                  void router.navigate({ to: '/task/$taskId', params: { taskId: task.lastSessionId } })
              }}
            >
              {t('查看执行对话')}
            </Button>
          )}
        </section>
      )}
    </>
  )
}

export function AndroidScheduledTasks() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage || i18n.language || 'en'
  const tasks = useScheduledAgentTasks()
  const groups = useMemo(() => groupScheduleAgenda(tasks), [tasks])
  const [selectedId, setSelectedId] = useAndroidRetainedState<string | null>('scheduled-tasks:selected', null)
  const selected = tasks.find((task) => task.id === selectedId) ?? groups[0]?.tasks[0]
  const [opened, setOpened] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteTarget = tasks.find((task) => task.id === deleteId)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const detailBody = useRef<HTMLDivElement>(null)
  const detailId = useId()
  const clock = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const activeCount = tasks.filter((task) => !isInactiveSchedule(task)).length
  const now = new Date()

  const selectTask = (id: string) => {
    setSelectedId(id)
    requestAnimationFrame(() => {
      if (detailBody.current) detailBody.current.scrollTop = 0
      if (
        getComputedStyle(detailRef.current || document.documentElement)
          .getPropertyValue('--schedule-stacked')
          .trim() === '1'
      ) {
        detailRef.current?.scrollIntoView?.({ block: 'nearest' })
      }
    })
  }

  const handleRun = async (id: string) => {
    setRunningId(id)
    setError(null)
    try {
      await executeScheduledAgentTask(id, { navigateToConversation: true, consumeSchedule: false })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError({ id, text: message === 'agent_busy' ? String(t('已有 Agent 任务正在执行')) : message })
    } finally {
      setRunningId(null)
    }
  }

  return (
    <>
      <div className="schedule-layout" data-has-tasks={Boolean(selected)}>
        <section className="schedule-plan" aria-label={String(t('执行计划'))}>
          <header className="schedule-plan-heading">
            <div>
              <h1>{t('执行计划')}</h1>
              <p>{t('已启用 {{active}} / {{total}}', { active: activeCount, total: tasks.length })}</p>
            </div>
            <Button
              className="yachiyo-primary-button"
              leftSection={<IconCalendarPlus size={17} />}
              onClick={() => setOpened(true)}
            >
              {t('新建定时任务')}
            </Button>
          </header>
          {selected ? (
            <section className="schedule-agenda" aria-label={String(t('定时任务列表'))}>
              {groups.map((group) => (
                <section className="schedule-day" key={group.day ?? 'inactive'}>
                  <h2>{group.day === null ? t('已暂停或结束') : groupHeading(group.day, now, locale)}</h2>
                  <ul>
                    {group.tasks.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          className="schedule-row"
                          aria-current={selected.id === task.id ? 'true' : undefined}
                          aria-controls={detailId}
                          onClick={() => selectTask(task.id)}
                        >
                          <time dateTime={new Date(task.runAt).toISOString()}>{clock.format(task.runAt)}</time>
                          <span aria-hidden="true" className="schedule-row-dot" />
                          <span className="schedule-row-copy">
                            <strong>{task.title}</strong>
                            <small>
                              {t(
                                task.status === 'scheduled' && !isInactiveSchedule(task) && !task.needsForeground
                                  ? repeatLabel[task.repeat]
                                  : scheduleStatusLabel(task)
                              )}
                            </small>
                          </span>
                          <IconChevronRight className="schedule-chevron" size={17} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ) : (
            <div className="schedule-empty">
              <IconClock size={32} aria-hidden="true" />
              <h2>{t('暂无定时任务')}</h2>
              <p>{t('点击“新建定时任务”添加第一项计划。')}</p>
            </div>
          )}
        </section>
        {selected && (
          <section id={detailId} ref={detailRef} className="schedule-detail" aria-label={String(t('任务详情'))}>
            <div className="schedule-detail-body" ref={detailBody}>
              {error?.id === selected.id && (
                <Alert role="alert" color="red" icon={<IconAlertTriangle size={18} />}>
                  {error.text}
                </Alert>
              )}
              <ScheduleDetail
                task={selected}
                locale={locale}
                onRun={() => void handleRun(selected.id)}
                onDelete={() => setDeleteId(selected.id)}
                busy={runningId}
              />
            </div>
          </section>
        )}
      </div>
      {opened && (
        <ScheduleForm
          opened={opened}
          onClose={() => setOpened(false)}
          onCreated={(id) => {
            setOpened(false)
            selectTask(id)
          }}
        />
      )}
      <AdaptiveModal opened={Boolean(deleteTarget)} onClose={() => setDeleteId(null)} title={t('确认删除')} centered>
        {deleteTarget && (
          <>
            <p className="schedule-delete-prompt">{t('删除定时任务“{{name}}”？', { name: deleteTarget.title })}</p>
            <AdaptiveModal.Actions>
              <Button variant="subtle" color="gray" onClick={() => setDeleteId(null)}>
                {t('取消')}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  deleteScheduledAgentTask(deleteTarget.id)
                  setDeleteId(null)
                }}
              >
                {t('删除')}
              </Button>
            </AdaptiveModal.Actions>
          </>
        )}
      </AdaptiveModal>
    </>
  )
}
