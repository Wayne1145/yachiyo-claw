import type { Message } from '@shared/types'
import { describe, expect, test } from 'vitest'
import { sequenceMessages } from '../../shared/utils/message'

describe('SequenceMessages', () => {
  // Each test case
  const cases: {
    name: string
    input: Message[]
    expected: Message[]
  }[] = [
    {
      name: 'should sequence messages correctly',
      input: [
        { id: '', role: 'system', contentParts: [{ type: 'text', text: 'S1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U2' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
        { id: '', role: 'system', contentParts: [{ type: 'text', text: 'S2' }] },
      ],
      expected: [
        {
          id: '',
          role: 'system',
          contentParts: [
            { type: 'text', text: 'S1' },
            { type: 'text', text: 'S2' },
          ],
        },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        {
          id: '',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'A1' },
            { type: 'text', text: 'A2' },
          ],
        },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U2' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
    },
    {
      name: '助手先于用户发言',
      input: [
        { id: '', role: 'system', contentParts: [{ type: 'text', text: 'S1' }] },
        {
          id: '',
          role: 'assistant',
          contentParts: [
            {
              type: 'text',
              text: `L1
L2
L3

`,
            },
          ],
        },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
      expected: [
        { id: '', role: 'system', contentParts: [{ type: 'text', text: 'S1' }] },
        {
          id: '',
          role: 'user',
          contentParts: [
            {
              type: 'text',
              text: `> L1
> L2
> L3
> 

`,
            },
          ],
        },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
    },
    {
      name: '没有系统消息',
      input: [
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
      expected: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '> A1\n' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
    },
    {
      name: '没有系统消息 2',
      input: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U2' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
      ],
      expected: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U2' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
      ],
    },
    {
      name: '去除空消息',
      input: [
        { id: '', role: 'system', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
      expected: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '> A1\n' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A3' }] },
      ],
    },
    {
      name: '只有 user 消息',
      input: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U2' }] },
      ],
      expected: [
        {
          id: '',
          role: 'user',
          contentParts: [
            { type: 'text', text: 'U1' },
            { type: 'text', text: 'U2' },
          ],
        },
      ],
    },
    {
      name: '只有 assistant 消息',
      input: [
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
      ],
      expected: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '> A1\n' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A2' }] },
      ],
    },
    {
      name: '只有一条 assistant 消息，应该转化成 user 消息',
      input: [{ id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] }],
      expected: [{ id: '', role: 'user', contentParts: [{ type: 'text', text: '> A1\n' }] }],
    },
    {
      name: '只有一条不为空的 assistant 消息，应该转化成 user 消息',
      input: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: 'A1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
      ],
      expected: [{ id: '', role: 'user', contentParts: [{ type: 'text', text: '> A1\n' }] }],
    },
    {
      name: '只有一条 system 消息，应该转化成 user 消息',
      input: [{ id: '', role: 'system', contentParts: [{ type: 'text', text: 'S1' }] }],
      expected: [{ id: '', role: 'user', contentParts: [{ type: 'text', text: 'S1' }] }],
    },
    {
      name: '只有一条不为空的 system 消息，应该转化成 user 消息',
      input: [
        { id: '', role: 'system', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'system', contentParts: [{ type: 'text', text: 'S1' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: '' }] },
        { id: '', role: 'assistant', contentParts: [{ type: 'text', text: '' }] },
      ],
      expected: [
        {
          id: '',
          role: 'user',
          contentParts: [
            { type: 'text', text: '' },
            { type: 'text', text: 'S1' },
          ],
        },
      ],
    },
    {
      name: '合并图片',
      input: [
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U1' }] },
        {
          id: '',
          role: 'user',
          contentParts: [
            { type: 'text', text: 'U2' },
            { type: 'image', storageKey: 'url1' },
          ],
        },
        {
          id: '',
          role: 'user',
          contentParts: [
            { type: 'text', text: 'U3' },
            { type: 'image', storageKey: 'url2' },
          ],
        },
        { id: '', role: 'user', contentParts: [{ type: 'text', text: 'U4' }] },
      ],
      expected: [
        {
          id: '',
          role: 'user',
          contentParts: [
            { type: 'text', text: 'U1' },
            { type: 'text', text: 'U2' },
            { type: 'image', storageKey: 'url1' },
            { type: 'text', text: 'U3' },
            { type: 'image', storageKey: 'url2' },
            { type: 'text', text: 'U4' },
          ],
        },
      ],
    },
  ]
  cases.forEach(({ name, input, expected }) => {
    test(name, () => {
      const got = sequenceMessages(input)

      expect(got.length).toBe(expected.length)

      got.forEach((gotMessage, index) => {
        const expectedMessage = expected[index]
        // If you have an isEqual method, you can use it here, or manually compare properties like this:
        expect(gotMessage).toEqual(expectedMessage)
      })
    })
  })

  test('multiple calls should not accumulate quote prefixes', () => {
    const originalMessages: Message[] = [
      { id: '1', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }] },
      { id: '2', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }] },
    ]

    // First call
    const result1 = sequenceMessages(originalMessages)
    expect(result1[0].contentParts[0]).toEqual({ type: 'text', text: '> Hello\n' })

    // Second call with same original messages should produce same result
    const result2 = sequenceMessages(originalMessages)
    expect(result2[0].contentParts[0]).toEqual({ type: 'text', text: '> Hello\n' })

    // Original messages should not be mutated
    expect(originalMessages[0].contentParts[0]).toEqual({ type: 'text', text: 'Hello' })

    // Third call should still produce same result
    const result3 = sequenceMessages(originalMessages)
    expect(result3[0].contentParts[0]).toEqual({ type: 'text', text: '> Hello\n' })
  })
})
