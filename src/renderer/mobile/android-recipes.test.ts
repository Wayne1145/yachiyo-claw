import { describe, expect, it } from 'vitest'
import type { GoalSpec } from '@shared/agent'
import {
  ANDROID_RECIPE_RESULT_MAX_BYTES,
  AndroidRecipeMatcher,
  AndroidRecipeRunner,
  AndroidRecipeStore,
  deriveRecipeRisk,
  sanitizeRecipeDescriptor,
  type RecipeExecutionHost,
  type RecipeStorage,
} from './android-recipes'

const recipe = {
  id: 'bilibili-follow',
  version: 1,
  appPackages: ['tv.danmaku.bili'],
  aliases: ['哔哩哔哩', 'b站'],
  supportedBackends: ['accessibility'],
  steps: [
    { kind: 'launch', packageName: 'tv.danmaku.bili' },
    { kind: 'observeSemantic' },
    { kind: 'clickNode', selector: { text: '关注' } },
    { kind: 'verify', selector: { text: '已关注' } },
  ],
  expectedState: { followed: true },
  risk: 'act',
  maxActions: 4,
  confirmedAt: Date.now(),
} as const

const goal: GoalSpec = {
  objective: '打开 b站并关注毕导',
  targetAppName: 'b站',
  constraints: { maxLocalActions: 20, maxCommits: 1, maxModelRequests: 3, maxReplans: 1, requireVerification: true },
}

class MemoryStorage implements RecipeStorage {
  value: unknown
  async getStoreValue(): Promise<unknown> {
    return this.value
  }
  async setStoreValue(_key: string, value: unknown): Promise<void> {
    this.value = value
  }
}

function host(calls: string[]): RecipeExecutionHost {
  const result = {
    success: true,
    output: JSON.stringify({
      version: 1,
      packageName: 'tv.danmak u.bili',
      nodes: [],
      nodeCount: 0,
      truncated: false,
      screenSignature: 'x',
    }),
  }
  return {
    launch: async () => {
      calls.push('launch')
      return { success: true }
    },
    observeSemantic: async () => {
      calls.push('observeSemantic')
      return result
    },
    findNode: async () => ({ success: true, found: true }),
    clickNode: async () => {
      calls.push('clickNode')
      return { success: true }
    },
    setNodeText: async () => ({ success: true }),
    scrollNode: async () => ({ success: true }),
    global: async () => ({ success: true }),
    verify: async () => {
      calls.push('verify')
      return true
    },
  }
}

describe('android recipes', () => {
  it('rejects arbitrary steps and redacts sensitive persisted text', () => {
    expect(sanitizeRecipeDescriptor({ ...recipe, steps: [{ kind: 'shell', command: 'rm -rf /' }] })).toBeNull()
    const sanitized = sanitizeRecipeDescriptor({
      ...recipe,
      steps: [{ kind: 'setNodeText', selector: { text: '密码' }, text: 'secret', sensitive: true }],
      maxActions: 1,
    })
    expect(sanitized?.steps[0]).toMatchObject({ kind: 'setNodeText', text: '' })
    expect(sanitized?.risk).toBe('destructive')
  })

  it('raises a recipe risk that is lower than its executable steps', () => {
    const sanitized = sanitizeRecipeDescriptor({ ...recipe, risk: 'read' })

    expect(sanitized?.risk).toBe('act')
    expect(deriveRecipeRisk(sanitized?.steps || [])).toBe('act')
  })

  it('does not lower a conservatively declared recipe risk', () => {
    const sanitized = sanitizeRecipeDescriptor({
      ...recipe,
      risk: 'destructive',
      steps: [{ kind: 'observeSemantic' }],
      maxActions: 1,
    })

    expect(sanitized?.risk).toBe('destructive')
  })

  it('matches a unique recipe locally using App Index and backend', async () => {
    const matcher = new AndroidRecipeMatcher({
      resolve: async () => ({
        kind: 'resolved',
        query: 'b站',
        app: { packageName: 'tv.danmaku.bili', label: '哔哩哔哩' },
        score: 1,
        matchedBy: 'alias',
      }),
    })
    await expect(matcher.match(goal, [recipe], { backend: 'accessibility' })).resolves.toMatchObject({
      kind: 'matched',
      recipe: { id: 'bilibili-follow' },
    })
    await expect(matcher.match(goal, [recipe], { backend: 'root' })).resolves.toMatchObject({ kind: 'not_found' })
  })

  it('runs only the allow-listed steps and returns a bounded projection', async () => {
    const calls: string[] = []
    const result = await new AndroidRecipeRunner(host(calls)).run(recipe, { taskId: 'task-1', host: host(calls) })
    expect(result.status).toBe('verified')
    expect(calls).toEqual(['launch', 'observeSemantic', 'clickNode', 'verify'])
    expect(result.bytes).toBeLessThanOrEqual(ANDROID_RECIPE_RESULT_MAX_BYTES)
  })

  it('requires confirmation before persisting a recipe', async () => {
    const storage = new MemoryStorage()
    const store = new AndroidRecipeStore(storage)
    await expect(store.save(recipe)).rejects.toThrow('recipe_confirmation_required')
    await store.save(recipe, true)
    await expect(store.list()).resolves.toHaveLength(1)
  })
})
