import { GoalSpecSchema } from '@shared/agent'
import { requestAgentApproval } from './agent-approval'
import { getAgentBackend } from './agent-broker'
import { createDefaultRecipeHost, tryRunStoredAndroidRecipe, type RecipeRunResult } from './android-recipes'

export interface LocalAndroidRecipeOutcome {
  handled: boolean
  result?: RecipeRunResult
  message?: string
}

/**
 * Try the local recipe path before a model is constructed. A missing or
 * ambiguous recipe is deliberately non-blocking; the caller can then use the
 * normal model fallback. A matched recipe that needs confirmation is blocking
 * so a denied side effect cannot be recreated by model planning.
 */
export async function tryRunLocalAndroidRecipe(taskId: string, content: string): Promise<LocalAndroidRecipeOutcome> {
  const goal = GoalSpecSchema.parse({
    objective: content.trim().slice(0, 4_096),
    constraints: {
      maxLocalActions: 20,
      maxCommits: 1,
      maxModelRequests: 3,
      maxReplans: 1,
      requireVerification: true,
    },
  })
  const attempt = await tryRunStoredAndroidRecipe(goal, {
    taskId,
    backend: getAgentBackend(),
    host: createDefaultRecipeHost(),
    confirm: (recipe) =>
      requestAgentApproval({
        sessionId: taskId,
        title: '运行本地 Android 流程',
        detail: recipe.id,
        risk: recipe.risk === 'destructive' ? 'dangerous' : 'dangerous',
      }),
  })
  if (!attempt.matched) return { handled: false }
  if (attempt.reason === 'confirmation_required') {
    return { handled: true, message: '已取消：本地流程需要确认后才能执行。' }
  }
  if (!attempt.result) return { handled: true, message: '本地流程未执行。' }
  const result = attempt.result
  if (result.status === 'verified' || result.status === 'applied') {
    return { handled: true, result, message: `本地流程已完成：${result.summary}` }
  }
  return { handled: true, result, message: `本地流程未完成：${result.summary}` }
}

