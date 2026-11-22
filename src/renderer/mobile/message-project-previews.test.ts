import { describe, expect, it } from 'vitest'
import type { Message, MessageToolCallPart } from '@shared/types'
import { localPreviewUrl, messageProjectPreviews } from './message-project-previews'

const tool: MessageToolCallPart = {
  type: 'tool-call',
  toolName: 'workspace_preview',
  toolCallId: 'call-1',
  args: {},
  state: 'result',
  result: { success: true, id: 'native-preview', url: 'http://127.0.0.1:8080/game' },
}
type Parts = Message['contentParts']
const previews = (...contentParts: Parts) => messageProjectPreviews({ role: 'assistant', contentParts })

describe('project deliveries in chat history', () => {
  it('combines a saved native preview and the assistant’s named delivery link', () => {
    const named = { type: 'text' as const, text: '[俄罗斯方块](http://localhost:8080/game)' }
    const expected = [{ title: '俄罗斯方块', url: 'http://127.0.0.1:8080/game', previewId: 'native-preview' }]
    expect(previews(tool, named)).toEqual(expected)
    expect(previews(named, tool)).toEqual(expected)
    expect(previews(named)[0].title).toBe('俄罗斯方块')
  })

  it('keeps instructions, other tools, example code and unsuccessful registrations out of project cards', () => {
    expect(messageProjectPreviews({ role: 'user', contentParts: [tool] })).toEqual([])
    const text = '```md\n[demo](http://localhost:8080)\n```\n`[demo](http://localhost:8080)`'
    expect(
      previews(
        { type: 'text', text },
        { ...tool, state: 'call' },
        { ...tool, state: 'error' },
        { ...tool, toolName: 'browser_snapshot' },
        { ...tool, result: { success: false, url: 'http://localhost/' } }
      )
    ).toEqual([])
  })

  it.each([
    'https://example.com/',
    'http://127.0.0.1.example:8080',
    'http://localhost:80@other.test/',
    'file:///tmp/index.html',
    'http://localhost:70000',
  ])('does not turn %s into a device project', (value) => {
    expect(localPreviewUrl(value)).toBeUndefined()
  })
})
