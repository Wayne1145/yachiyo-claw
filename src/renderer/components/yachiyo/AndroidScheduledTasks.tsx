import { ActionIcon, Alert, Button, Select, Switch, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconClock,
  IconPlayerPlay,
  IconRepeat,
  IconTrash,
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  createScheduledAgentTask,
  deleteScheduledAgentTask,
  executeScheduledAgentTask,
  installScheduledAgentTaskRunner,
  type ScheduledTaskRepeat,
  updateScheduledAgentTask,
  useScheduledAgentTasks,
} from '@/mobile/scheduled-agent-tasks'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 16)
}

function formatRunTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

const repeatLabel: Record<ScheduledTaskRepeat, string> = {
  once: '仅一次',
  daily: '每天',
  weekly: '每周',
}

export function AndroidScheduledTaskRunner() {
  useEffect(() => installScheduledAgentTaskRunner(), [])
  return null
}

export function AndroidScheduledTasks() {
  const { t, i18n } = useTranslation()
  const tasks = useScheduledAgentTasks()
  const [opened, setOpened] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [runAt, setRunAt] = useState(() => toLocalDateTimeInput(Date.now() + 5 * 60_000))
  const [repeat, setRepeat] = useState<ScheduledTaskRepeat>('once')
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const counts = useMemo(
    () => ({
      running: tasks.filter((task) => task.status === 'running').length,
      waiting: tasks.filter((task) => task.enabled && task.status !== 'running').length,
      scheduled: tasks.length,
    }),
    [tasks]
  )

  const resetForm = () => {
    setTitle('')
    setPrompt('')
    setRunAt(toLocalDateTimeInput(Date.now() + 5 * 60_000))
    setRepeat('once')
    setError('')
  }

  const handleCreate = () => {
    setSaving(true)
    setError('')
    try {
      const timestamp = new Date(runAt).getTime()
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('schedule_time_in_past')
      createScheduledAgentTask({ title, prompt, runAt: timestamp, repeat })
      setOpened(false)
      resetForm()
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === 'task_prompt_required'
          ? String(t('请输入任务指令'))
          : reason instanceof Error && reason.message === 'schedule_time_in_past'
            ? String(t('执行时间必须晚于当前时间'))
            : String(reason)
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async (id: string) => {
    setRunningId(id)
    setError('')
    try {
      await executeScheduledAgentTask(id, { navigateToConversation: true, consumeSchedule: false })
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === 'agent_busy'
          ? String(t('已有 Agent 任务正在执行'))
          : String(reason)
      )
    } finally {
      setRunningId(null)
    }
  }

  return (
    <>
      <section className="yachiyo-task-toolbar" aria-label={String(t('任务操作'))}>
        <div>
          <Title order={2}>{t('自动执行')}</Title>
          <Text c="dimmed" size="sm">
            {t('到达设定时间后使用当前 Agent 配置运行任务。')}
          </Text>
        </div>
        <Button
          className="yachiyo-primary-button"
          leftSection={<IconCalendarPlus size={18} />}
          onClick={() => setOpened(true)}
        >
          {t('新建定时任务')}
        </Button>
      </section>

      <section className="yachiyo-status-panel" aria-label={String(t('任务概览'))}>
        <div className="yachiyo-status-row">
          <span>{t('运行中')}</span>
          <strong>{counts.running}</strong>
        </div>
        <div className="yachiyo-status-row">
          <span>{t('等待中')}</span>
          <strong>{counts.waiting}</strong>
        </div>
        <div className="yachiyo-status-row">
          <span>{t('全部任务')}</span>
          <strong>{counts.scheduled}</strong>
        </div>
      </section>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      {tasks.length === 0 ? (
        <section className="yachiyo-empty-panel">
          <IconClock size={32} aria-hidden="true" />
          <Title order={2}>{t('暂无定时任务')}</Title>
          <Text c="dimmed">{t('点击“新建定时任务”添加第一项计划。')}</Text>
        </section>
      ) : (
        <section className="yachiyo-scheduled-task-list" aria-label={String(t('定时任务列表'))}>
          {tasks.map((task) => {
            const taskActions: AdaptiveActionDescriptor[] = [
              {
                id: 'enabled',
                label: `${task.title} ${String(t('启用状态'))}`,
                priority: 100,
                collapseStrategy: 'keep',
                renderControl: () => (
                  <Switch
                    size="sm"
                    checked={task.enabled}
                    aria-label={`${task.title} ${t('启用状态')}`}
                    onChange={(event) =>
                      updateScheduledAgentTask(task.id, {
                        enabled: event.currentTarget.checked,
                        status: event.currentTarget.checked ? 'scheduled' : task.status,
                      })
                    }
                  />
                ),
              },
              {
                id: 'run',
                label: String(t('立即运行')),
                icon: IconPlayerPlay,
                priority: 90,
                collapseStrategy: 'icon',
                renderControl: ({ presentation }) =>
                  presentation === 'labelled' ? (
                    <Button
                      variant="subtle"
                      color="chatbox-brand"
                      leftSection={<IconPlayerPlay size={18} />}
                      loading={runningId === task.id}
                      onClick={() => void handleRun(task.id)}
                    >
                      {t('立即运行')}
                    </Button>
                  ) : (
                    <Tooltip label={t('立即运行')}>
                      <ActionIcon
                        size={44}
                        variant="subtle"
                        color="chatbox-brand"
                        loading={runningId === task.id}
                        aria-label={`${t('立即运行')} ${task.title}`}
                        onClick={() => void handleRun(task.id)}
                      >
                        <IconPlayerPlay size={18} />
                      </ActionIcon>
                    </Tooltip>
                  ),
              },
              {
                id: 'delete',
                label: String(t('删除')),
                icon: IconTrash,
                priority: 10,
                collapseStrategy: 'overflow',
                renderControl: () => (
                  <Tooltip label={t('删除')}>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="gray"
                      aria-label={`${t('删除')} ${task.title}`}
                      onClick={() => deleteScheduledAgentTask(task.id)}
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                ),
                menuAction: {
                  onSelect: () => deleteScheduledAgentTask(task.id),
                },
              },
            ]

            return (
              <article key={task.id} className="yachiyo-scheduled-task-row">
                <div className="yachiyo-scheduled-task-time" aria-hidden="true">
                  <IconClock size={19} />
                </div>
                <div className="yachiyo-scheduled-task-copy">
                  <strong>{task.title}</strong>
                  <span>
                    {formatRunTime(task.runAt, i18n.resolvedLanguage || i18n.language)} · {t(repeatLabel[task.repeat])}
                  </span>
                  {task.lastError && <small>{task.lastError}</small>}
                </div>
                <AdaptiveActionCluster
                  className="yachiyo-scheduled-task-actions"
                  ariaLabel={`${task.title} ${String(t('任务操作'))}`}
                  actions={taskActions}
                />
              </article>
            )
          })}
        </section>
      )}

      <AdaptiveModal
        opened={opened}
        onClose={() => {
          setOpened(false)
          resetForm()
        }}
        title={t('新建定时任务')}
        centered
      >
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
            minRows={4}
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
            data={[
              { value: 'once', label: String(t('仅一次')) },
              { value: 'daily', label: String(t('每天')) },
              { value: 'weekly', label: String(t('每周')) },
            ]}
            onChange={(value) => setRepeat((value as ScheduledTaskRepeat) || 'once')}
          />
          {error && <Alert color="red">{error}</Alert>}
          <AdaptiveModal.Actions>
            <Button variant="subtle" color="gray" onClick={() => setOpened(false)}>
              {t('取消')}
            </Button>
            <Button className="yachiyo-primary-button" loading={saving} onClick={handleCreate}>
              {t('保存任务')}
            </Button>
          </AdaptiveModal.Actions>
        </div>
      </AdaptiveModal>
    </>
  )
}
