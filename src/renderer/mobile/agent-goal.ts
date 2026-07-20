import { GoalSpecSchema } from '@shared/agent'
import { createMessage, type Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { estimateTokens } from '@/packages/token'

export const DEVICE_GOAL_MAX_TOKENS = 1_024

function truncateGoalToTokenBudget(value: string): string {
  if (estimateTokens(value) <= DEVICE_GOAL_MAX_TOKENS) return value
  let low = 1
  let high = value.length
  let best = value.slice(0, Math.min(value.length, DEVICE_GOAL_MAX_TOKENS * 4))
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = value.slice(0, middle)
    if (estimateTokens(candidate) <= DEVICE_GOAL_MAX_TOKENS) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best.trimEnd()
}

/** Reduce a device run to one local, structured goal instead of replaying chat history. */
export function buildDeviceGoalContext(messages: Message[]): Message[] {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!latestUser) return messages.slice(-1)
  const objective = truncateGoalToTokenBudget(getMessageText(latestUser, true, true).trim().slice(0, 6_000))
  const goalSpec = GoalSpecSchema.parse({
    objective,
    constraints: {
      maxLocalActions: 20,
      maxCommits: 1,
      maxModelRequests: 3,
      maxReplans: 1,
      requireVerification: true,
    },
  })
  return [createMessage('user', `<goal_spec>${JSON.stringify(goalSpec)}</goal_spec>`)]
}
