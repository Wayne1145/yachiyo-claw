// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { queryClient } from './queryClient'
import {
  createTaskSession,
  getTaskSession,
  TASK_SESSION_QUERY_KEY,
  updateTaskSession,
} from './taskSessionStore'

describe('task session creation', () => {
  it('publishes a persisted task to the route cache before returning', async () => {
    const session = await createTaskSession({
      name: 'New Task',
      workingDirectory: 'default',
      messages: [],
    })

    expect(queryClient.getQueryData([TASK_SESSION_QUERY_KEY, session.id])).toEqual(session)
    await expect(getTaskSession(session.id)).resolves.toEqual(session)
  })

  it('patches tokens without reverting unpersisted streamed content', async () => {
    const session = await createTaskSession({ name: 'Streaming', workingDirectory: 'default', messages: [
      { id: 'answer', role: 'assistant', generating: true, contentParts: [{ type: 'text', text: 'before' }] },
    ] })
    const key = [TASK_SESSION_QUERY_KEY, session.id]
    queryClient.setQueryData(key, { ...session, messages: [
      { ...session.messages[0], contentParts: [{ type: 'text', text: 'latest token' }] },
    ] })
    await updateTaskSession(session.id, current => ({ messages: current.messages.map(message => ({
      ...message, tokenCountMap: { default: 3 },
    })) }))
    const stored = await getTaskSession(session.id)
    expect(stored?.messages[0].contentParts).toEqual([{ type: 'text', text: 'latest token' }])
    expect(stored?.messages[0].generating).toBe(true)
  })
})
