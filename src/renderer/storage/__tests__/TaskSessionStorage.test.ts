import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IndexedDBTaskSessionStorage } from '../TaskSessionStorage'

describe('atomic Agent task updates', () => {
  it('retains new replies when token metadata and message appends race', async () => {
    const storage = new IndexedDBTaskSessionStorage()
    const user = { id: 'user', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'continue' }] }
    const reply = { id: 'reply', role: 'assistant' as const, generating: true, contentParts: [] }
    await storage.create({ id: 'atomic-task', name: 'test', workingDirectory: '.', createdAt: 1, messages: [user] })
    await Promise.all([
      storage.update('atomic-task', { messages: [user, reply] }),
      storage.update('atomic-task', (current) => ({
        messages: current.messages.map(m => m.id === user.id ? { ...m, tokenCountMap: { default: 3 } } : m),
      })),
      storage.update('atomic-task', { name: 'renamed' }),
    ])
    const current = await storage.getById('atomic-task')
    expect(current?.messages).toHaveLength(2)
    expect(current?.messages[1]).toEqual(reply)
    expect(current?.messages[0].tokenCountMap).toMatchObject({ default: 3 })
    expect(current?.name).toBe('renamed')
  })

  it('rolls back a failing patch without changing stored messages', async () => {
    const storage = new IndexedDBTaskSessionStorage()
    await storage.create({ id: 'aborted-task', name: 'original', workingDirectory: '.', createdAt: 1, messages: [] })
    await expect(storage.update('aborted-task', () => { throw new Error('patch failed') })).rejects.toThrow('patch failed')
    expect((await storage.getById('aborted-task'))?.name).toBe('original')
  })
})
