import { describe, expect, it } from 'vitest'
import { WorkspaceAgentController } from './workspace-agent'

function createAdapter(files: Record<string, string>) {
  return {
    read: async (path: string) => files[path] ?? null,
    write: async (path: string, content: string) => {
      files[path] = content
    },
    remove: async (path: string) => {
      delete files[path]
    },
  }
}

describe('WorkspaceAgentController', () => {
  it('requires approval and applies unique structured patches', async () => {
    const files = { 'src/a.ts': 'const value = 1\n' }
    const controller = new WorkspaceAgentController({
      root: { id: 'root', displayName: 'repo', path: '/repo', platform: 'desktop' },
      adapter: createAdapter(files),
      approve: async () => true,
    })
    const plan = controller.createPlan('update value', [
      { kind: 'update', path: 'src/a.ts', search: 'const value = 1', replace: 'const value = 2' },
    ])
    const result = await controller.apply(plan)
    expect(result.state).toBe('completed')
    expect(files['src/a.ts']).toContain('const value = 2')
  })

  it('pauses without approval and rejects non-unique replacements', async () => {
    const files = { 'src/a.ts': 'x\nx\n' }
    const controller = new WorkspaceAgentController({
      root: { id: 'root', displayName: 'repo', path: '/repo', platform: 'android-saf' },
      adapter: createAdapter(files),
      approve: async () => false,
    })
    const paused = await controller.apply(
      controller.createPlan('write', [{ kind: 'update', path: 'src/a.ts', search: 'x', replace: 'y' }])
    )
    expect(paused.state).toBe('paused')

    const allowed = new WorkspaceAgentController({
      root: { id: 'root', displayName: 'repo', path: '/repo', platform: 'desktop' },
      adapter: createAdapter(files),
      approve: async () => true,
    })
    await expect(
      allowed.apply(allowed.createPlan('ambiguous', [{ kind: 'update', path: 'src/a.ts', search: 'x', replace: 'y' }]))
    ).rejects.toThrow('workspace_search_not_unique')
  })
})
