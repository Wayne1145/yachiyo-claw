import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { resolveAgentActiveTools, selectAndroidActiveTools, selectAndroidToolStage } from './android-tool-stages'

function message(role: ModelMessage['role'], text: string): ModelMessage {
  return { role, content: [{ type: 'text', text }] } as ModelMessage
}

describe('Android tool stages', () => {
  it('starts with observation and structured launch tools only', () => {
    expect(selectAndroidToolStage(0, [])).toBe('initial')
    expect(selectAndroidActiveTools(0, [])).toEqual([
      'android_device_info',
      'android_permission_status',
      'android_app_list',
      'android_observe',
      'android_launch_app',
      'android_run_recipe',
    ])
  })

  it('opens semantic actions after the first step and coordinate fallback after a tool failure', () => {
    expect(selectAndroidActiveTools(1, [message('assistant', 'launch ok')])).toContain('android_click_node')
    expect(selectAndroidActiveTools(1, [message('tool', 'node_not_found')])).toContain('android_tap')
  })

  it('does not widen tool access because user or assistant text mentions an error', () => {
    const messages = [message('user', 'Fix an error in this app'), message('assistant', 'I will inspect the error')]
    expect(selectAndroidToolStage(0, messages)).toBe('initial')
    expect(selectAndroidToolStage(1, messages)).toBe('stable')
    expect(selectAndroidActiveTools(1, messages)).not.toContain('android_tap')
  })

  it('reduces the tool set after a verified tool result', () => {
    expect(selectAndroidActiveTools(2, [message('tool', 'recipe_verified')])).toEqual(['android_observe'])
  })

  it('keeps internal tools available while Android tools advance through stages', () => {
    const requested = ['sandbox_bash', 'load_skill', 'android_observe', 'android_launch_app']

    expect(selectAndroidActiveTools(1, [message('assistant', 'continue')], requested)).toEqual(
      expect.arrayContaining(['sandbox_bash', 'load_skill', 'android_click_node']),
    )
    expect(selectAndroidActiveTools(2, [message('tool', 'recipe_verified')], requested)).toEqual([
      'sandbox_bash',
      'load_skill',
      'android_observe',
    ])
  })

  it('focuses coding turns on sandbox and preview tools without leaking the Ubuntu plugin', () => {
    const requested = [
      'agent_environment_status',
      'agent_complete',
      'sandbox_write',
      'workspace_preview',
      'web_search',
      'load_skill',
      'random_mcp_tool',
      'ubuntu-runtime_exec',
    ]
    const active = selectAndroidActiveTools(
      0,
      [message('user', '用 html 写一个小游戏，部署到本地 8080 端口')],
      requested,
    )

    expect(active).toEqual(
      expect.arrayContaining([
        'agent_environment_status',
        'agent_complete',
        'sandbox_write',
        'workspace_preview',
      ]),
    )
    expect(active).not.toContain('web_search')
    expect(active).not.toContain('load_skill')
    expect(active).not.toContain('random_mcp_tool')
    expect(active).not.toContain('ubuntu-runtime_exec')
  })

  it('exposes the Ubuntu plugin only when a coding task explicitly needs Ubuntu compatibility', () => {
    const requested = ['agent_complete', 'sandbox_bash', 'ubuntu-runtime_exec']
    const active = selectAndroidActiveTools(
      0,
      [message('user', '在 Ubuntu 里用 apt 安装依赖并运行 Python 项目')],
      requested,
    )

    expect(active).toContain('ubuntu-runtime_exec')
  })

  it('routes from registered internal tools when no staged list was supplied', () => {
    const active = resolveAgentActiveTools(
      0,
      [message('user', '写一个 html 页面')],
      undefined,
      ['agent_complete', 'sandbox_write'],
    )

    expect(active).toEqual(['agent_complete', 'sandbox_write'])
    expect(active).not.toContain('android_observe')
  })
})
