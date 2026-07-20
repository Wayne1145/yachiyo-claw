import { v4 as uuidv4 } from 'uuid'
import { type WorkspaceAgentPlan, WorkspaceAgentPlanSchema, type WorkspacePatchOperation, validateWorkspacePatch, validateWorkspaceRelativePath, type WorkspaceRoot } from '@shared/agent/workspace'
import { AgentBudgetTracker, type AgentBudget } from './agent-budget'

export interface WorkspaceCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface WorkspaceAdapter {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  remove?(path: string): Promise<void>
  run?(command: string, timeout?: number): Promise<WorkspaceCommandResult>
  git?(command: 'status' | 'diff' | 'log'): Promise<WorkspaceCommandResult>
}

export interface WorkspaceApproval {
  (input: { action: 'write' | 'delete' | 'command' | 'commit'; detail: string }): Promise<boolean>
}

export interface WorkspaceAgentOptions {
  root: WorkspaceRoot
  adapter: WorkspaceAdapter
  approve?: WorkspaceApproval
  budget?: Partial<AgentBudget>
  now?: () => number
}

function defaultApproval(): WorkspaceApproval {
  return async () => false
}

/**
 * Structured coding-agent operations. File writes and commands are explicit
 * operations so a model cannot turn free-form text into an implicit mutation.
 */
export class WorkspaceAgentController {
  readonly budget: AgentBudgetTracker
  private readonly now: () => number

  constructor(private readonly options: WorkspaceAgentOptions) {
    this.budget = new AgentBudgetTracker(options.budget)
    this.now = options.now || Date.now
  }

  createPlan(objective: string, operations: WorkspacePatchOperation[] = [], testCommands: string[] = []): WorkspaceAgentPlan {
    const now = this.now()
    const plan: WorkspaceAgentPlan = {
      schemaVersion: 1,
      id: uuidv4(),
      objective: objective.trim().slice(0, 6_000),
      root: this.options.root,
      state: 'draft',
      operations: operations.map(validateWorkspacePatch),
      testCommands: testCommands.map((command) => command.trim()).filter(Boolean).slice(0, 20),
      createdAt: now,
      updatedAt: now,
      checkpoint: 0,
      commitRequested: false,
    }
    return WorkspaceAgentPlanSchema.parse(plan)
  }

  async read(path: string): Promise<string | null> {
    this.budget.reserveLocalAction()
    return this.options.adapter.read(validateWorkspaceRelativePath(path))
  }

  async apply(plan: WorkspaceAgentPlan): Promise<WorkspaceAgentPlan> {
    const parsed = WorkspaceAgentPlanSchema.parse(plan)
    if (parsed.root.id !== this.options.root.id) throw new Error('workspace_root_mismatch')
    const approve = this.options.approve || defaultApproval()
    let next: WorkspaceAgentPlan = { ...parsed, state: 'applying', updatedAt: this.now() }
    for (let index = parsed.checkpoint; index < parsed.operations.length; index += 1) {
      const operation = validateWorkspacePatch(parsed.operations[index])
      this.budget.reserveLocalAction()
      const allowed = await approve({ action: operation.kind === 'delete' ? 'delete' : 'write', detail: operation.path })
      if (!allowed) return { ...next, state: 'paused', updatedAt: this.now(), checkpoint: index }
      const safePath = validateWorkspaceRelativePath(operation.path)
      if (operation.kind === 'create') {
        await this.options.adapter.write(safePath, operation.content)
      } else if (operation.kind === 'update') {
        const current = await this.options.adapter.read(safePath)
        if (current === null) throw new Error(`workspace_file_not_found:${safePath}`)
        const occurrences = current.split(operation.search).length - 1
        if (occurrences !== 1) throw new Error(`workspace_search_not_unique:${safePath}`)
        await this.options.adapter.write(safePath, current.replace(operation.search, operation.replace))
      } else {
        if (!this.options.adapter.remove) throw new Error('workspace_delete_unavailable')
        await this.options.adapter.remove(safePath)
      }
      next = { ...next, checkpoint: index + 1, updatedAt: this.now() }
    }
    return { ...next, state: 'completed', updatedAt: this.now() }
  }

  async runTests(plan: WorkspaceAgentPlan): Promise<{ plan: WorkspaceAgentPlan; results: WorkspaceCommandResult[] }> {
    const parsed = WorkspaceAgentPlanSchema.parse(plan)
    if (!this.options.adapter.run) return { plan: { ...parsed, state: 'paused', updatedAt: this.now() }, results: [] }
    const approve = this.options.approve || defaultApproval()
    const results: WorkspaceCommandResult[] = []
    for (const command of parsed.testCommands) {
      this.budget.reserveLocalAction()
      if (!(await approve({ action: 'command', detail: command }))) {
        return { plan: { ...parsed, state: 'paused', updatedAt: this.now() }, results }
      }
      results.push(await this.options.adapter.run(command, this.budget.remainingMs))
      if (results.at(-1)?.exitCode !== 0) {
        return { plan: { ...parsed, state: 'failed', updatedAt: this.now() }, results }
      }
    }
    return { plan: { ...parsed, state: 'completed', updatedAt: this.now() }, results }
  }

  async gitStatus(): Promise<WorkspaceCommandResult> {
    this.budget.reserveLocalAction()
    if (!this.options.adapter.git) throw new Error('workspace_git_unavailable')
    return this.options.adapter.git('status')
  }
}

export function createWorkspaceAgent(options: WorkspaceAgentOptions): WorkspaceAgentController {
  return new WorkspaceAgentController(options)
}
