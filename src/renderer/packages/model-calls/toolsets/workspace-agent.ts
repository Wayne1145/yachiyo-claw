import { tool } from 'ai'
import { z } from 'zod'
import { WorkspaceAgentPlanSchema, type WorkspaceRoot } from '@shared/agent/workspace'
import { requestAgentApproval } from '@/mobile/agent-approval'
import { createWorkspaceAgent } from '@/mobile/workspace-agent'
import platform from '@/platform'

function unavailable(message: string) {
  return { success: false, stdout: '', stderr: message, exitCode: 127 }
}

export function createWorkspaceAgentToolSet(sessionId?: string) {
  const rootState: WorkspaceRoot = {
    id: sessionId || 'default-workspace',
    displayName: '当前工作区',
    path: 'workspace',
    platform: platform.type === 'mobile' ? 'android-private' : 'desktop',
  }
  const adapter = {
    read: async (path: string) => {
      if (platform.sandboxRead) {
        const result = await platform.sandboxRead({ filePath: path })
        return result.success ? result.content || '' : null
      }
      if (platform.type !== 'mobile') return null
      try {
        const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem')
        const result = await Filesystem.readFile({ path: `yachiyo-workspace/${path}`, directory: Directory.Data, encoding: Encoding.UTF8 })
        return typeof result.data === 'string' ? result.data : null
      } catch {
        return null
      }
    },
    write: async (path: string, content: string) => {
      if (platform.sandboxWrite) {
        const result = await platform.sandboxWrite({ filePath: path, content })
        if (!result.success) throw new Error(result.error || 'workspace_write_failed')
        return
      }
      if (platform.type !== 'mobile') throw new Error('workspace_write_unavailable')
      const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem')
      await Filesystem.writeFile({
        path: `yachiyo-workspace/${path}`,
        data: content,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      })
    },
    remove: async (path: string) => {
      if (platform.type !== 'mobile') throw new Error('workspace_delete_unavailable')
      const { Directory, Filesystem } = await import('@capacitor/filesystem')
      await Filesystem.deleteFile({ path: `yachiyo-workspace/${path}`, directory: Directory.Data })
    },
    run: async (command: string, timeout?: number) => {
      if (!platform.sandboxExec) return unavailable('workspace_command_unavailable')
      return platform.sandboxExec({ command, timeout })
    },
    git: async (command: 'status' | 'diff' | 'log') => {
      if (!platform.sandboxExec) return unavailable('workspace_git_unavailable')
      return platform.sandboxExec({ command: `git ${command}`, timeout: 30_000 })
    },
  }
  const agent = createWorkspaceAgent({
    root: rootState,
    adapter,
    approve: ({ action, detail }) =>
      requestAgentApproval({
        sessionId,
        title: `工作区${action === 'command' ? '命令' : '修改'}`,
        detail,
        risk: 'dangerous',
      }),
  })

  return {
    description:
      '\n<workspace_agent>Use structured workspace plans, patches, tests, and git status. All writes and commands require approval; paths are relative and traversal-safe.</workspace_agent>\n',
    tools: {
      workspace_plan: tool({
        description: 'Create a resumable structured coding plan without changing files.',
        inputSchema: z.object({
          objective: z.string().min(1).max(6_000),
          test_commands: z.array(z.string().min(1).max(2_000)).max(20).optional(),
        }),
        execute: ({ objective, test_commands }) => agent.createPlan(objective, [], test_commands || []),
      }),
      workspace_apply_patch: tool({
        description: 'Apply an explicitly listed structured patch after per-operation approval.',
        inputSchema: z.object({ plan: WorkspaceAgentPlanSchema }),
        execute: ({ plan }) => agent.apply(plan),
      }),
      workspace_run_tests: tool({
        description: 'Run the test commands stored in a workspace plan after approval.',
        inputSchema: z.object({ plan: WorkspaceAgentPlanSchema }),
        execute: ({ plan }) => agent.runTests(plan),
      }),
      workspace_git_status: tool({
        description: 'Read git status for the selected workspace.',
        inputSchema: z.object({}),
        execute: () => agent.gitStatus(),
      }),
    },
  }
}

export default createWorkspaceAgentToolSet()
