import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertTriangle,
  IconCalendarPlus,
  IconClock,
  IconPlayerPlay,
  IconRepeat,
  IconTrash,
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import {
  createScheduledAgentTask,
  deleteScheduledAgentTask,
  executeScheduledAgentTask,
  installScheduledAgentTaskRunner,
  type ScheduledTaskRepeat,
  updateScheduledAgentTask,
  useScheduledAgentTasks,
} from '@/mobile/scheduled-agent-tasks'

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 16)
}

function formatRunTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
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
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('执行时间必须晚于当前时间')
      createScheduledAgentTask({ title, prompt, runAt: timestamp, repeat })
      setOpened(false)
      resetForm()
    } catch (reason) {
      setError(reason instanceof Error && reason.message === 'task_prompt_required' ? '请输入任务指令' : String(reason))
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
      setError(reason instanceof Error && reason.message === 'agent_busy' ? '已有 Agent 任务正在执行' : String(reason))
    } finally {
      setRunningId(null)
    }
  }

  return (
    <>
      <section className="yachiyo-task-toolbar" aria-label="任务操作">
        <div>
          <Title order={2}>自动执行</Title>
          <Text c="dimmed" size="sm">
            到达设定时间后使用当前 Agent 配置运行任务。
          </Text>
        </div>
        <Button
          className="yachiyo-primary-button"
          leftSection={<IconCalendarPlus size={18} />}
          onClick={() => setOpened(true)}
        >
          新建定时任务
        </Button>
      </section>

      <section className="yachiyo-status-panel" aria-label="任务概览">
        <div className="yachiyo-status-row">
          <span>运行中</span>
          <strong>{counts.running}</strong>
        </div>
        <div className="yachiyo-status-row">
          <span>等待中</span>
          <strong>{counts.waiting}</strong>
        </div>
        <div className="yachiyo-status-row">
          <span>全部任务</span>
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
          <Title order={2}>暂无定时任务</Title>
          <Text c="dimmed">点击“新建定时任务”添加第一项计划。</Text>
        </section>
      ) : (
        <section className="yachiyo-scheduled-task-list" aria-label="定时任务列表">
          {tasks.map((task) => (
            <article key={task.id} className="yachiyo-scheduled-task-row">
              <div className="yachiyo-scheduled-task-time" aria-hidden="true">
                <IconClock size={19} />
              </div>
              <div className="yachiyo-scheduled-task-copy">
                <strong>{task.title}</strong>
                <span>
                  {formatRunTime(task.runAt)} · {repeatLabel[task.repeat]}
                </span>
                {task.lastError && <small>{task.lastError}</small>}
              </div>
              <div className="yachiyo-scheduled-task-actions">
                <Switch
                  size="sm"
                  checked={task.enabled}
                  aria-label={`${task.title}启用状态`}
                  onChange={(event) =>
                    updateScheduledAgentTask(task.id, {
                      enabled: event.currentTarget.checked,
                      status: event.currentTarget.checked ? 'scheduled' : task.status,
                    })
                  }
                />
                <Tooltip label="立即运行">
                  <ActionIcon
                    variant="subtle"
                    color="pink"
                    loading={runningId === task.id}
                    aria-label={`立即运行${task.title}`}
                    onClick={() => void handleRun(task.id)}
                  >
                    <IconPlayerPlay size={18} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="删除">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`删除${task.title}`}
                    onClick={() => deleteScheduledAgentTask(task.id)}
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                </Tooltip>
              </div>
            </article>
          ))}
        </section>
      )}

      <Modal
        opened={opened}
        onClose={() => {
          setOpened(false)
          resetForm()
        }}
        title="新建定时任务"
        centered
      >
        <div className="yachiyo-scheduled-task-form">
          <TextInput
            label="名称"
            placeholder="例如：每日整理通知"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Textarea
            label="Agent 指令"
            placeholder="描述需要 Agent 完成的操作"
            minRows={4}
            autosize
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <TextInput
            type="datetime-local"
            label="执行时间"
            leftSection={<IconClock size={17} />}
            min={toLocalDateTimeInput(Date.now() + 60_000)}
            value={runAt}
            onChange={(event) => setRunAt(event.currentTarget.value)}
          />
          <Select
            label="重复"
            leftSection={<IconRepeat size={17} />}
            value={repeat}
            data={[
              { value: 'once', label: '仅一次' },
              { value: 'daily', label: '每天' },
              { value: 'weekly', label: '每周' },
            ]}
            onChange={(value) => setRepeat((value as ScheduledTaskRepeat) || 'once')}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setOpened(false)}>
              取消
            </Button>
            <Button className="yachiyo-primary-button" loading={saving} onClick={handleCreate}>
              保存任务
            </Button>
          </Group>
        </div>
      </Modal>
    </>
  )
}
