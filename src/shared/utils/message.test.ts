import { describe, expect, it, vi } from 'vitest'

vi.mock('./word_count', () => ({
  countWord: vi.fn(() => 123),
}))

import type { Message, MessageContentParts, MessagePicture } from '../types'
import {
  cloneMessage,
  countMessageWords,
  fixMessageRoleSequence,
  getMessageText,
  isEmptyMessage,
  mergeMessages,
  migrateMessage,
  sequenceMessages,
} from './message'
import { countWord } from './word_count'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'user',
    contentParts: [],
    ...overrides,
  }
}

function textPart(text: string): MessageContentParts[number] {
  return { type: 'text', text }
}

type LegacyMessageInput = Omit<Message, 'contentParts'> & {
  contentParts?: MessageContentParts
  content?: string
  webBrowsing?: {
    query: string[]
    links: { title: string; url: string }[]
  }
  pictures?: MessagePicture[]
}

describe('getMessageText', () => {
  it('returns joined text parts', () => {
    const msg = createMessage({
      contentParts: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    })

    expect(getMessageText(msg)).toBe('hello\nworld')
  })

  it('extracts text from text parts', () => {
    const message = createMessage({
      contentParts: [textPart('hello'), textPart('world')],
    })

    expect(getMessageText(message)).toBe('hello\nworld')
  })

  it('handles image placeholders based on includeImagePlaceHolder', () => {
    const msg = createMessage({
      contentParts: [{ type: 'image', storageKey: 'img-1' }],
    })

    expect(getMessageText(msg, true)).toBe('[image]')
    expect(getMessageText(msg, false)).toBe('')
  })

  it('includes image placeholder by default and can disable it', () => {
    const message = createMessage({
      contentParts: [textPart('before'), { type: 'image', storageKey: 'image-1' }, textPart('after')],
    })

    expect(getMessageText(message)).toBe('before\n[image]\nafter')
    expect(getMessageText(message, false)).toBe('before\nafter')
  })

  it('handles reasoning parts based on includeReasoning', () => {
    const msg = createMessage({
      contentParts: [{ type: 'reasoning', text: 'chain-of-thought' }],
    })

    expect(getMessageText(msg, true, false)).toBe('')
    expect(getMessageText(msg, true, true)).toBe('chain-of-thought')
  })

  it('excludes reasoning by default and can include reasoning text', () => {
    const message = createMessage({
      contentParts: [textPart('question'), { type: 'reasoning', text: 'thinking...' }, textPart('answer')],
    })

    expect(getMessageText(message)).toBe('question\nanswer')
    expect(getMessageText(message, true, true)).toBe('question\nthinking...\nanswer')
  })

  it('returns empty string for empty contentParts', () => {
    expect(getMessageText(createMessage())).toBe('')
  })

  it('keeps empty-line placeholders for non-text part types', () => {
    const message = createMessage({
      contentParts: [
        textPart('hello'),
        { type: 'info', text: 'meta' },
        { type: 'tool-call', state: 'call', toolCallId: '1', toolName: 'x', args: { q: 'a' } },
      ],
    })

    expect(getMessageText(message)).toBe('hello\n\n')
  })

  it('handles mixed parts with selective inclusion', () => {
    const msg = createMessage({
      contentParts: [
        { type: 'text', text: 'intro' },
        { type: 'image', storageKey: 'img-2' },
        { type: 'reasoning', text: 'hidden reasoning' },
        { type: 'reasoning', text: 'shown reasoning' },
      ],
    })

    expect(getMessageText(msg, true, false)).toBe('intro\n[image]')
    expect(getMessageText(msg, false, true)).toBe('intro\nhidden reasoning\nshown reasoning')
  })
})

describe('migrateMessage', () => {
  it('keeps existing contentParts', () => {
    const input: LegacyMessageInput = {
      id: 'm1',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'already migrated' }],
    }

    const result = migrateMessage(input)
    expect(result.contentParts).toEqual([{ type: 'text', text: 'already migrated' }])
  })

  it('migrates legacy content field when contentParts is empty', () => {
    const input: LegacyMessageInput = {
      id: 'm2',
      role: 'user',
      content: 'legacy text',
      contentParts: [],
    }

    const result = migrateMessage(input)
    expect(result.contentParts).toEqual([{ type: 'text', text: 'legacy text' }])
  })

  it('migrates legacy content into contentParts when contentParts is missing', () => {
    const legacyMessage: LegacyMessageInput = {
      id: 'm1',
      role: 'assistant',
      content: 'legacy text',
    }

    const result = migrateMessage(legacyMessage)

    expect(result.contentParts).toEqual([{ type: 'text', text: 'legacy text' }])
    expect(result.role).toBe('assistant')
    expect((result as Message & { content?: string }).content).toBe('legacy text')
  })

  it('migrates placeholder contentParts using legacy content and pictures', () => {
    const input: LegacyMessageInput = {
      id: 'm3',
      role: 'user',
      content: 'real content',
      contentParts: [{ type: 'text', text: '...' }],
      pictures: [{ storageKey: 'pic-1' }, { url: 'https://example.com/a.png' }, {}],
    }

    const result = migrateMessage(input)
    expect(result.contentParts).toEqual([
      { type: 'text', text: 'real content' },
      { type: 'image', storageKey: 'pic-1', url: undefined },
      { type: 'image', storageKey: undefined, url: 'https://example.com/a.png' },
    ])
  })

  it('migrates when contentParts is placeholder text', () => {
    const legacyMessage: LegacyMessageInput = {
      id: 'm2',
      role: 'user',
      content: 'actual content',
      contentParts: [{ type: 'text', text: '...' }],
    }

    const result = migrateMessage(legacyMessage)

    expect(result.contentParts).toEqual([{ type: 'text', text: 'actual content' }])
  })

  it('includes valid legacy pictures as image parts', () => {
    const pictures: MessagePicture[] = [
      { storageKey: 'stored-1' },
      { url: 'https://example.com/a.png' },
      { loading: true },
    ]
    const legacyMessage: LegacyMessageInput = {
      id: 'm3',
      role: 'user',
      content: 'with images',
      pictures,
    }

    const result = migrateMessage(legacyMessage)

    expect(result.contentParts).toEqual([
      { type: 'text', text: 'with images' },
      { type: 'image', storageKey: 'stored-1', url: undefined },
      { type: 'image', storageKey: undefined, url: 'https://example.com/a.png' },
    ])
  })

  it('converts webBrowsing into leading tool-call content part', () => {
    const input: LegacyMessageInput = {
      id: 'm4',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'answer' }],
      webBrowsing: {
        query: ['alpha', 'beta'],
        links: [{ title: 'Doc A', url: 'https://example.com/a' }],
      },
    }

    const result = migrateMessage(input)

    expect((result as { webBrowsing?: unknown }).webBrowsing).toBeUndefined()
    expect(result.contentParts[0]).toEqual({
      type: 'tool-call',
      state: 'result',
      toolCallId: 'web_search_m4',
      toolName: 'web_search',
      args: { query: 'alpha, beta' },
      result: {
        query: 'alpha, beta',
        searchResults: [
          {
            title: 'Doc A',
            link: 'https://example.com/a',
            snippet: 'Doc A',
          },
        ],
      },
    })
    expect(result.contentParts[1]).toEqual({ type: 'text', text: 'answer' })
  })

  it('adds web browsing tool-call result at the beginning and removes webBrowsing', () => {
    const legacyMessage: LegacyMessageInput = {
      id: 'm4',
      role: 'assistant',
      content: 'result',
      webBrowsing: {
        query: ['vitest', 'docs'],
        links: [{ title: 'Vitest', url: 'https://vitest.dev' }],
      },
    }

    const result = migrateMessage(legacyMessage)

    expect(result.contentParts[0]).toEqual({
      type: 'tool-call',
      state: 'result',
      toolCallId: 'web_search_m4',
      toolName: 'web_search',
      args: { query: 'vitest, docs' },
      result: {
        query: 'vitest, docs',
        searchResults: [{ title: 'Vitest', link: 'https://vitest.dev', snippet: 'Vitest' }],
      },
    })
    expect((result as Message & { webBrowsing?: unknown }).webBrowsing).toBeUndefined()
  })

  it('keeps existing non-empty contentParts and does not replace with content', () => {
    const legacyMessage: LegacyMessageInput = {
      id: 'm5',
      role: 'assistant',
      content: 'legacy',
      contentParts: [textPart('new format')],
    }

    const result = migrateMessage(legacyMessage)

    expect(result.contentParts).toEqual([textPart('new format')])
  })
})

describe('cloneMessage', () => {
  it('creates a deep clone', () => {
    const original = createMessage({
      id: 'orig',
      contentParts: [{ type: 'text', text: 'source' }],
      files: [
        {
          id: 'f1',
          name: 'a.txt',
          fileType: 'text/plain',
          tokenCalculatedAt: undefined,
        },
      ],
      links: [
        {
          id: 'l1',
          url: 'https://example.com',
          title: 'Example',
          tokenCalculatedAt: undefined,
        },
      ],
    })

    const cloned = cloneMessage(original)
    cloned.contentParts[0] = { type: 'text', text: 'changed' }
    cloned.files![0].name = 'b.txt'
    cloned.links![0].title = 'Changed'

    expect(original.contentParts[0]).toEqual({ type: 'text', text: 'source' })
    expect(original.files![0].name).toBe('a.txt')
    expect(original.links![0].title).toBe('Example')
  })

  it('deep clones nested fields', () => {
    const original = createMessage({
      id: 'original',
      contentParts: [textPart('hello')],
      files: [{ id: 'f1', name: 'doc.txt', fileType: 'text/plain', tokenCalculatedAt: {} }],
      links: [{ id: 'l1', title: 'site', url: 'https://example.com', tokenCalculatedAt: {} }],
    })

    const cloned = cloneMessage(original)
    cloned.contentParts[0] = textPart('changed')
    if (cloned.files) {
      cloned.files[0].name = 'changed.txt'
    }

    expect(cloned).toEqual({
      ...original,
      contentParts: [textPart('changed')],
      files: [{ id: 'f1', name: 'changed.txt', fileType: 'text/plain', tokenCalculatedAt: {} }],
      links: [{ id: 'l1', title: 'site', url: 'https://example.com', tokenCalculatedAt: {} }],
    })
    expect(original.contentParts).toEqual([textPart('hello')])
    expect(original.files?.[0].name).toBe('doc.txt')
  })
})

describe('isEmptyMessage', () => {
  it('returns true for empty message', () => {
    expect(isEmptyMessage(createMessage())).toBe(true)
  })

  it('returns true for fully empty message', () => {
    expect(isEmptyMessage(createMessage())).toBe(true)
  })

  it('returns false when message has text', () => {
    expect(isEmptyMessage(createMessage({ contentParts: [{ type: 'text', text: 'hello' }] }))).toBe(false)
  })

  it('returns false when text exists', () => {
    expect(isEmptyMessage(createMessage({ contentParts: [textPart('hello')] }))).toBe(false)
  })

  it('returns false when only image exists (placeholder text)', () => {
    expect(isEmptyMessage(createMessage({ contentParts: [{ type: 'image', storageKey: 'img' }] }))).toBe(false)
  })

  it('returns false when reasoning exists', () => {
    expect(isEmptyMessage(createMessage({ contentParts: [{ type: 'reasoning', text: 'thoughts' }] }))).toBe(false)
  })

  it('returns false when message has files only', () => {
    const msg = createMessage({
      files: [{ id: 'f1', name: 'a.txt', fileType: 'text/plain', tokenCalculatedAt: undefined }],
    })
    expect(isEmptyMessage(msg)).toBe(false)
  })

  it('returns false when message has links only', () => {
    const msg = createMessage({
      links: [{ id: 'l1', url: 'https://example.com', title: 'X', tokenCalculatedAt: undefined }],
    })
    expect(isEmptyMessage(msg)).toBe(false)
  })

  it('returns false when files or links exist even with empty text', () => {
    const withFile = createMessage({
      files: [{ id: 'f1', name: 'doc.txt', fileType: 'text/plain', tokenCalculatedAt: {} }],
    })
    const withLink = createMessage({
      links: [{ id: 'l1', title: 'site', url: 'https://example.com', tokenCalculatedAt: {} }],
    })

    expect(isEmptyMessage(withFile)).toBe(false)
    expect(isEmptyMessage(withLink)).toBe(false)
  })
})

describe('countMessageWords', () => {
  it('delegates to countWord with message text', () => {
    const msg = createMessage({
      contentParts: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    })

    const result = countMessageWords(msg)

    expect(countWord).toHaveBeenCalledTimes(1)
    expect(countWord).toHaveBeenCalledWith('hello\nworld')
    expect(result).toBe(123)
  })

  it('counts words from message text', () => {
    const message = createMessage({ contentParts: [textPart('hello world')] })

    const result = countMessageWords(message)

    expect(countWord).toHaveBeenCalledWith('hello world')
    expect(result).toBe(123)
  })

  it('counts image placeholder as one word and ignores reasoning by default', () => {
    const message = createMessage({
      contentParts: [
        textPart('hello'),
        { type: 'image', storageKey: 'img' },
        { type: 'reasoning', text: 'hidden reasoning' },
      ],
    })

    const result = countMessageWords(message)

    expect(countWord).toHaveBeenCalledWith('hello\n[image]')
    expect(result).toBe(123)
  })

  it('returns mocked count for empty message text', () => {
    const result = countMessageWords(createMessage({ contentParts: [] }))

    expect(countWord).toHaveBeenCalledWith('')
    expect(result).toBe(123)
  })
})

describe('mergeMessages', () => {
  it('merges contentParts from both messages', () => {
    const a = createMessage({ id: 'a', contentParts: [{ type: 'text', text: 'first' }] })
    const b = createMessage({ id: 'b', contentParts: [{ type: 'text', text: 'second' }] })

    const merged = mergeMessages(a, b)

    expect(merged.contentParts).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ])
    expect(a.contentParts).toEqual([{ type: 'text', text: 'first' }])
    expect(b.contentParts).toEqual([{ type: 'text', text: 'second' }])
  })

  it('preserves first message identity fields', () => {
    const a = createMessage({ id: 'a', role: 'user', contentParts: [textPart('A')] })
    const b = createMessage({ id: 'b', role: 'assistant', contentParts: [textPart('B')] })

    const result = mergeMessages(a, b)

    expect(result.id).toBe('a')
    expect(result.role).toBe('user')
    expect(result.contentParts).toEqual([textPart('A'), textPart('B')])
  })

  it('does not mutate inputs', () => {
    const a = createMessage({ contentParts: [textPart('A')] })
    const b = createMessage({ contentParts: [textPart('B')] })

    const result = mergeMessages(a, b)
    result.contentParts[0] = textPart('changed')

    expect(a.contentParts).toEqual([textPart('A')])
    expect(b.contentParts).toEqual([textPart('B')])
  })

  it('handles undefined contentParts in the second message', () => {
    const a = createMessage({ contentParts: [textPart('A')] })
    const b = createMessage({ contentParts: undefined as unknown as MessageContentParts })

    const result = mergeMessages(a, b)

    expect(result.contentParts).toEqual([textPart('A')])
  })
})

describe('fixMessageRoleSequence', () => {
  it('returns single message unchanged', () => {
    const single = [createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'hi' }] })]

    expect(fixMessageRoleSequence(single)).toEqual(single)
  })

  it('returns single assistant message after prepending user placeholder', () => {
    const message = createMessage({ id: 'only', role: 'assistant', contentParts: [textPart('solo')] })

    const result = fixMessageRoleSequence([message])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 'user_before_assistant_id', role: 'user', contentParts: [textPart('OK.')] })
    expect(result[1]).toEqual(message)
  })

  it('merges consecutive same-role messages', () => {
    const input = [
      createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'a' }] }),
      createMessage({ id: 'u2', role: 'user', contentParts: [{ type: 'text', text: 'b' }] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'c' }] }),
      createMessage({ id: 'a2', role: 'assistant', contentParts: [{ type: 'text', text: 'd' }] }),
    ]

    const result = fixMessageRoleSequence(input)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[0].contentParts).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])
    expect(result[1].role).toBe('assistant')
    expect(result[1].contentParts).toEqual([
      { type: 'text', text: 'c' },
      { type: 'text', text: 'd' },
    ])
  })

  it('merges consecutive messages with the same role', () => {
    const messages = [
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('Q1')] }),
      createMessage({ id: 'u2', role: 'user', contentParts: [textPart('Q2')] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('A1')] }),
      createMessage({ id: 'a2', role: 'assistant', contentParts: [textPart('A2')] }),
    ]

    const result = fixMessageRoleSequence(messages)

    expect(result).toEqual([
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('Q1'), textPart('Q2')] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('A1'), textPart('A2')] }),
    ])
  })

  it('inserts a user message before first assistant when needed', () => {
    const input = [createMessage({ id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'hello' }] })]

    const result = fixMessageRoleSequence(input)

    expect(result[0]).toEqual({
      role: 'user',
      contentParts: [{ type: 'text', text: 'OK.' }],
      id: 'user_before_assistant_id',
    })
    expect(result[1].role).toBe('assistant')
  })

  it('does not insert a user message when assistant is already preceded by user', () => {
    const messages = [
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('Question')] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('Answer')] }),
    ]

    const result = fixMessageRoleSequence(messages)

    expect(result).toEqual(messages)
  })
})

describe('sequenceMessages', () => {
  it('merges all system messages first', () => {
    const input = [
      createMessage({ id: 's1', role: 'system', contentParts: [{ type: 'text', text: 'sys-1' }] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'user-1' }] }),
      createMessage({ id: 's2', role: 'system', contentParts: [{ type: 'text', text: 'sys-2' }] }),
    ]

    const result = sequenceMessages(input)

    expect(result[0].role).toBe('system')
    expect(result[0].contentParts).toEqual([
      { type: 'text', text: 'sys-1' },
      { type: 'text', text: 'sys-2' },
    ])
    expect(result[1].role).toBe('user')
    expect(getMessageText(result[1])).toBe('user-1')
  })

  it('merges all system messages at the beginning', () => {
    const messages = [
      createMessage({ id: 's1', role: 'system', contentParts: [textPart('sys-1')] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('user')] }),
      createMessage({ id: 's2', role: 'system', contentParts: [textPart('sys-2')] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('assistant')] }),
    ]

    const result = sequenceMessages(messages)

    expect(result[0].role).toBe('system')
    expect(result[0].contentParts).toEqual([textPart('sys-1'), textPart('sys-2')])
    expect(result[1].role).toBe('user')
    expect(result[2].role).toBe('assistant')
  })

  it('keeps alternating user/assistant sequence and merges consecutive same roles', () => {
    const input = [
      createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'u1' }] }),
      createMessage({ id: 'u2', role: 'user', contentParts: [{ type: 'text', text: 'u2' }] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'a1' }] }),
      createMessage({ id: 'a2', role: 'assistant', contentParts: [{ type: 'text', text: 'a2' }] }),
      createMessage({ id: 'u3', role: 'user', contentParts: [{ type: 'text', text: 'u3' }] }),
    ]

    const result = sequenceMessages(input)

    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(result[0].contentParts).toEqual([
      { type: 'text', text: 'u1' },
      { type: 'text', text: 'u2' },
    ])
    expect(result[1].contentParts).toEqual([
      { type: 'text', text: 'a1' },
      { type: 'text', text: 'a2' },
    ])
    expect(result[2].contentParts).toEqual([{ type: 'text', text: 'u3' }])
  })

  it('quotes first assistant message into first user message', () => {
    const input = [
      createMessage({ id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'line1\nline2' }] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'my reply' }] }),
    ]

    const result = sequenceMessages(input)

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].contentParts).toEqual([
      { type: 'text', text: '> line1\n> line2\n' },
      { type: 'text', text: 'my reply' },
    ])
  })

  it('quotes assistant messages before the first user message', () => {
    const messages = [
      createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('first answer')] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('follow-up question')] }),
    ]

    const result = sequenceMessages(messages)

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].contentParts).toEqual([textPart('> first answer\n'), textPart('follow-up question')])
  })

  it('skips empty messages', () => {
    const input = [
      createMessage({ id: 'u-empty', role: 'user', contentParts: [] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'kept' }] }),
      createMessage({ id: 'a-empty', role: 'assistant', contentParts: [] }),
    ]

    const result = sequenceMessages(input)

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(getMessageText(result[0])).toBe('kept')
  })

  it('skips empty messages and merges consecutive same-role messages', () => {
    const messages = [
      createMessage({ id: 'u0', role: 'user', contentParts: [] }),
      createMessage({ id: 'u1', role: 'user', contentParts: [textPart('Q1')] }),
      createMessage({ id: 'u2', role: 'user', contentParts: [textPart('Q2')] }),
      createMessage({ id: 'a1', role: 'assistant', contentParts: [] }),
      createMessage({ id: 'a2', role: 'assistant', contentParts: [textPart('A1')] }),
    ]

    const result = sequenceMessages(messages)

    expect(result).toEqual([
      createMessage({ id: '', role: 'user', contentParts: [textPart('Q1'), textPart('Q2')] }),
      createMessage({ id: 'a2', role: 'assistant', contentParts: [textPart('A1')] }),
    ])
  })

  it('converts single system-only message to user role', () => {
    const input = [createMessage({ id: 's1', role: 'system', contentParts: [{ type: 'text', text: 'rules' }] })]

    const result = sequenceMessages(input)

    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(getMessageText(result[0])).toBe('rules')
  })

  it('converts single non-empty system message result to user role', () => {
    const result = sequenceMessages([createMessage({ id: 's1', role: 'system', contentParts: [textPart('only')] })])

    expect(result).toEqual([createMessage({ id: '', role: 'user', contentParts: [textPart('only')] })])
  })

  it('does not mutate input messages while quoting assistant content', () => {
    const source = [createMessage({ id: 'a1', role: 'assistant', contentParts: [textPart('raw answer')] })]

    const firstCall = sequenceMessages(source)
    const secondCall = sequenceMessages(source)

    expect(firstCall[0].contentParts).toEqual([textPart('> raw answer\n')])
    expect(secondCall[0].contentParts).toEqual([textPart('> raw answer\n')])
    expect(source[0].contentParts).toEqual([textPart('raw answer')])
  })
})
