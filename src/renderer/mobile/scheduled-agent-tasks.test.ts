/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  buildHeadlessRuntimeSnapshot,
  calculateNextScheduledRunAt,
  recoverInterruptedScheduledTasks,
} from './scheduled-agent-tasks'
import { settingsStore } from '@/stores/settingsStore'

describe('scheduled agent tasks', () => {
  it('advances daily schedules beyond missed runs', () => {
    const day = 24 * 60 * 60 * 1000
    expect(calculateNextScheduledRunAt('daily', 1_000, 1_000 + day * 3)).toBe(1_000 + day * 4)
  })

  it('advances weekly schedules and leaves one-time schedules unchanged', () => {
    const week = 7 * 24 * 60 * 60 * 1000
    expect(calculateNextScheduledRunAt('weekly', 5_000, 5_000 + week)).toBe(5_000 + week * 2)
    expect(calculateNextScheduledRunAt('once', 5_000, 50_000)).toBe(5_000)
  })

  it('recovers a task left running after process termination', () => {
    const [task] = recoverInterruptedScheduledTasks([
      {
        id: 'task-1',
        title: 'demo',
        prompt: 'run',
        runAt: 1,
        repeat: 'daily',
        enabled: true,
        status: 'running',
        createdAt: 1,
      },
    ])
    expect(task.status).toBe('failed')
    expect(task.enabled).toBe(true)
    expect(task.lastError).toContain('重新执行')
  })

  it('captures an OpenAI-compatible default model without exposing it in schedule metadata', () => {
    settingsStore.setState({
      defaultChatModel: { provider: 'yachiyo', model: 'gpt-5.6' },
      providers: { yachiyo: { apiKey: 'sk-headless-test' } },
      defaultPrompt: 'Soul prompt',
      reasoningStrength: 'high',
    })
    expect(buildHeadlessRuntimeSnapshot('task/id')).toMatchObject({
      protocol: 'openai-chat-completions',
      apiHost: 'https://api.yachiyo8000.cn/v1/chat/completions',
      apiKey: 'sk-headless-test',
      model: 'gpt-5.6',
      reasoningStrength: 'high',
      workspaceId: 'schedule:task_id',
    })
    expect(buildHeadlessRuntimeSnapshot('task/id')?.systemPrompt).toContain('<agent_soul>')
  })

  it('falls back to foreground execution when no API key can be encrypted into the task', () => {
    settingsStore.setState({
      defaultChatModel: { provider: 'yachiyo', model: 'gpt-5.6' },
      providers: { yachiyo: { apiKey: '' } },
    })
    expect(buildHeadlessRuntimeSnapshot('task')).toBeUndefined()
  })
})
