// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { queryClient } from './queryClient'
import {
  createTaskSession,
  getTaskSession,
  TASK_SESSION_QUERY_KEY,
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
})
